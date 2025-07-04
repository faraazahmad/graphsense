import net, { AddressInfo } from "node:net";
import os from "node:os";

interface PortOptions {
  host?: string;
  port?: number | number[];
  exclude?: Iterable<number>;
}

interface CheckPortOptions {
  host?: string;
  port: number;
}

class Locked extends Error {
  constructor(port: number) {
    super(`${port} is locked`);
  }
}

const lockedPorts: {
  old: Set<number>;
  young: Set<number>;
} = {
  old: new Set(),
  young: new Set(),
};

// On this interval, the old locked ports are discarded,
// the young locked ports are moved to old locked ports,
// and a new young set for locked ports are created.
const releaseOldLockedPortsIntervalMs = 1000 * 15;

const minPort = 1024;
const maxPort = 65_535;

// Lazily create timeout on first use
let timeout: NodeJS.Timeout | undefined;

const getLocalHosts = (): Set<string | undefined> => {
  const interfaces = os.networkInterfaces();

  // Add undefined value for createServer function to use default host,
  // and default IPv4 host in case createServer defaults to IPv6.
  const results = new Set([undefined, "0.0.0.0"]);

  for (const _interface of Object.values(interfaces)) {
    if (!_interface) {
      continue;
    }

    for (const config of _interface) {
      results.add(config.address);
    }
  }

  return results;
};

const checkAvailablePort = (options: CheckPortOptions): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);

    server.listen(options, () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => {
        resolve(port);
      });
    });
  });

const getAvailablePort = async (
  options: CheckPortOptions,
  hosts: Set<string | undefined>,
): Promise<number> => {
  if (options.host || options.port === 0) {
    return checkAvailablePort(options);
  }

  for (const host of hosts) {
    try {
      await checkAvailablePort({ port: options.port, host }); // eslint-disable-line no-await-in-loop
    } catch (error: any) {
      if (!["EADDRNOTAVAIL", "EINVAL"].includes(error.code)) {
        throw error;
      }
    }
  }

  return options.port;
};

const portCheckSequence = function* (
  ports: number[] | undefined,
): Generator<number, void, unknown> {
  if (ports) {
    yield* ports;
  }

  yield 0; // Fall back to 0 if anything else failed
};

export default async function getPorts(options?: PortOptions): Promise<number> {
  let ports: number[] | undefined;
  let exclude: Set<number> = new Set();

  if (options) {
    if (options.port) {
      ports = typeof options.port === "number" ? [options.port] : options.port;
    }

    if (options.exclude) {
      const excludeIterable = options.exclude;

      if (typeof excludeIterable[Symbol.iterator] !== "function") {
        throw new TypeError("The `exclude` option must be an iterable.");
      }

      for (const element of excludeIterable) {
        if (typeof element !== "number") {
          throw new TypeError(
            "Each item in the `exclude` option must be a number corresponding to the port you want excluded.",
          );
        }

        if (!Number.isSafeInteger(element)) {
          throw new TypeError(
            `Number ${element} in the exclude option is not a safe integer and can't be used`,
          );
        }
      }

      exclude = new Set(excludeIterable);
    }
  }

  if (timeout === undefined) {
    timeout = setTimeout(() => {
      timeout = undefined;

      lockedPorts.old = lockedPorts.young;
      lockedPorts.young = new Set();
    }, releaseOldLockedPortsIntervalMs);

    // Does not exist in some environments (Electron, Jest jsdom env, browser, etc).
    if (timeout.unref) {
      timeout.unref();
    }
  }

  const hosts = getLocalHosts();

  for (const port of portCheckSequence(ports)) {
    try {
      if (exclude.has(port)) {
        continue;
      }

      let availablePort: number = await getAvailablePort(
        { ...options, port },
        hosts,
      ); // eslint-disable-line no-await-in-loop
      while (
        lockedPorts.old.has(availablePort) ||
        lockedPorts.young.has(availablePort)
      ) {
        if (port !== 0) {
          throw new Locked(port);
        }

        availablePort = await getAvailablePort({ ...options, port }, hosts); // eslint-disable-line no-await-in-loop
      }

      lockedPorts.young.add(availablePort);

      return availablePort;
    } catch (error: any) {
      if (
        !["EADDRINUSE", "EACCES"].includes(error.code) &&
        !(error instanceof Locked)
      ) {
        throw error;
      }
    }
  }

  throw new Error("No available ports found");
}

export function portNumbers(
  from: number,
  to: number,
): Generator<number, void, unknown> {
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    throw new TypeError("`from` and `to` must be integer numbers");
  }

  if (from < minPort || from > maxPort) {
    throw new RangeError(`'from' must be between ${minPort} and ${maxPort}`);
  }

  if (to < minPort || to > maxPort) {
    throw new RangeError(`'to' must be between ${minPort} and ${maxPort}`);
  }

  if (from > to) {
    throw new RangeError("`to` must be greater than or equal to `from`");
  }

  const generator = function* (
    from: number,
    to: number,
  ): Generator<number, void, unknown> {
    for (let port = from; port <= to; port++) {
      yield port;
    }
  };

  return generator(from, to);
}

export function clearLockedPorts() {
  lockedPorts.old.clear();
  lockedPorts.young.clear();
}
