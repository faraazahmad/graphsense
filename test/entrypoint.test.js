const { describe, it, before, after, beforeEach, afterEach } = require("mocha");
const { expect } = require("chai");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const sqlite3 = require("sqlite3").verbose();

const testDir = path.join(os.tmpdir(), "graphsense-test");
const originalHome = process.env.HOME;

// Set HOME before importing the module
process.env.HOME = testDir;

// Import functions from entrypoint after setting HOME
const {
  initializeContainerDB,
  findAvailablePorts,
  getRepoPath,
} = require("../entrypoint");

describe("GraphSense Entrypoint", function () {
  this.timeout(60000); // 60 second timeout for tests

  const testGraphsenseDir = path.join(testDir, ".graphsense");
  const testDbFile = path.join(testGraphsenseDir, "containers.db");
  
  before(function () {
    // Create test directory structure
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  after(function () {
    // Restore original HOME
    process.env.HOME = originalHome;
    
    // Clean up test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe("Container Database", function () {
    afterEach(function (done) {
      // Clean up database after each test
      if (fs.existsSync(testDbFile)) {
        fs.unlinkSync(testDbFile);
      }
      if (fs.existsSync(testGraphsenseDir)) {
        fs.rmSync(testGraphsenseDir, { recursive: true, force: true });
      }
      done();
    });

    it("should initialize SQLite database", async function () {
      await initializeContainerDB();
      
      // Wait a bit for filesystem operations to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(fs.existsSync(testGraphsenseDir)).to.be.true;
      expect(fs.existsSync(testDbFile)).to.be.true;
      
      // Verify table was created
      const db = new sqlite3.Database(testDbFile);
      
      return new Promise((resolve, reject) => {
        db.get(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='containers'",
          (err, row) => {
            db.close();
            if (err) reject(err);
            expect(row).to.not.be.undefined;
            expect(row.name).to.equal("containers");
            resolve();
          }
        );
      });
    });

    it("should create .graphsense directory if it doesn't exist", async function () {
      expect(fs.existsSync(testGraphsenseDir)).to.be.false;
      
      await initializeContainerDB();
      
      // Wait a bit for filesystem operations to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(fs.existsSync(testGraphsenseDir)).to.be.true;
    });
  });

  describe("Port Allocation", function () {
    it("should find available ports for services", async function () {
      const ports = await findAvailablePorts();
      
      expect(ports).to.have.property("postgresPort");
      expect(ports).to.have.property("neo4jPort");
      expect(ports).to.have.property("neo4jHttpPort");
      
      expect(ports.postgresPort).to.be.a("number");
      expect(ports.neo4jPort).to.be.a("number");
      expect(ports.neo4jHttpPort).to.be.a("number");
      
      expect(ports.postgresPort).to.be.at.least(5432);
      expect(ports.neo4jPort).to.be.at.least(7687);
      expect(ports.neo4jHttpPort).to.be.at.least(7474);
    });

    it("should allocate different ports for different services", async function () {
      const ports = await findAvailablePorts();
      
      const allPorts = [ports.postgresPort, ports.neo4jPort, ports.neo4jHttpPort];
      const uniquePorts = [...new Set(allPorts)];
      
      expect(uniquePorts.length).to.equal(allPorts.length);
    });
  });

  describe("Repository Path Handling", function () {
    const originalArgv = process.argv.slice();
    
    afterEach(function () {
      process.argv = originalArgv.slice();
    });

    it("should get repository path from command line arguments", function () {
      const testRepoPath = "/tmp/test-repo";
      
      // Create test repo directory
      if (!fs.existsSync(testRepoPath)) {
        fs.mkdirSync(testRepoPath, { recursive: true });
      }
      
      process.argv[2] = testRepoPath;
      
      const repoPath = getRepoPath();
      expect(repoPath).to.equal(path.resolve(testRepoPath));
      
      // Clean up
      fs.rmSync(testRepoPath, { recursive: true, force: true });
    });

    it("should exit with error if repository path doesn't exist", function () {
      const nonExistentPath = "/tmp/non-existent-repo";
      process.argv[2] = nonExistentPath;
      
      let exitCalled = false;
      const originalExit = process.exit;
      process.exit = (code) => {
        exitCalled = true;
        expect(code).to.equal(1);
      };
      
      try {
        getRepoPath();
      } catch (error) {
        // Expected to throw or exit
      }
      
      process.exit = originalExit;
      expect(exitCalled).to.be.true;
    });

    it("should exit with error if no repository path provided", function () {
      process.argv = process.argv.slice(0, 2); // Remove all arguments
      
      let exitCalled = false;
      const originalExit = process.exit;
      process.exit = (code) => {
        exitCalled = true;
        expect(code).to.equal(1);
      };
      
      try {
        getRepoPath();
      } catch (error) {
        // Expected to throw or exit
      }
      
      process.exit = originalExit;
      expect(exitCalled).to.be.true;
    });
  });

  describe("Build Process", function () {
    it("should build TypeScript files", function (done) {
      this.timeout(30000);
      
      const buildProcess = spawn("npm", ["run", "build"], {
        stdio: "pipe",
        cwd: path.join(__dirname, ".."),
      });

      let stdout = "";
      let stderr = "";

      buildProcess.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      buildProcess.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      buildProcess.on("close", (code) => {
        if (code !== 0) {
          console.log("Build stdout:", stdout);
          console.log("Build stderr:", stderr);
        }
        expect(code).to.equal(0);
        
        // Check that build directory exists
        const buildDir = path.join(__dirname, "..", "build");
        expect(fs.existsSync(buildDir)).to.be.true;
        
        // Check that key files were built
        const expectedFiles = ["index.js", "mcp.js", "watcher.js"];
        for (const file of expectedFiles) {
          expect(fs.existsSync(path.join(buildDir, file))).to.be.true;
        }
        
        done();
      });

      buildProcess.on("error", (error) => {
        done(error);
      });
    });
  });

  describe("Docker Integration", function () {
    before(function () {
      // Check if Docker is available
      try {
        require("child_process").execSync("docker --version", { stdio: "pipe" });
      } catch (error) {
        this.skip("Docker not available");
      }
    });

    it("should be able to check Docker availability", function (done) {
      const dockerProcess = spawn("docker", ["--version"], { stdio: "pipe" });
      
      dockerProcess.on("close", (code) => {
        expect(code).to.equal(0);
        done();
      });

      dockerProcess.on("error", (error) => {
        done(error);
      });
    });

    it("should be able to pull required Docker images", function (done) {
      this.timeout(120000); // 2 minutes for image pulling
      
      const images = ["pgvector/pgvector:pg17", "neo4j:latest"];
      let completed = 0;
      
      images.forEach((image) => {
        const pullProcess = spawn("docker", ["pull", image], { stdio: "pipe" });
        
        pullProcess.on("close", (code) => {
          expect(code).to.equal(0);
          completed++;
          if (completed === images.length) {
            done();
          }
        });
        
        pullProcess.on("error", (error) => {
          done(error);
        });
      });
    });
  });

  describe("Integration Test", function () {
    let testRepoPath;
    
    before(function () {
      // Create a test repository
      testRepoPath = path.join(os.tmpdir(), "test-graphsense-repo");
      if (fs.existsSync(testRepoPath)) {
        fs.rmSync(testRepoPath, { recursive: true, force: true });
      }
      fs.mkdirSync(testRepoPath, { recursive: true });
      
      // Create a simple JavaScript file for testing
      const testFile = path.join(testRepoPath, "test.js");
      fs.writeFileSync(testFile, `
        const fs = require('fs');
        const path = require('path');
        
        function testFunction() {
          return "Hello, GraphSense!";
        }
        
        module.exports = { testFunction };
      `);
    });

    after(function () {
      // Clean up test repository
      if (fs.existsSync(testRepoPath)) {
        fs.rmSync(testRepoPath, { recursive: true, force: true });
      }
    });

    it("should handle complete workflow without Docker", async function () {
      this.timeout(30000);
      
      // Test the main components without actually starting Docker containers
      process.argv[2] = testRepoPath;
      
      // Test repository path resolution
      const repoPath = getRepoPath();
      expect(repoPath).to.equal(path.resolve(testRepoPath));
      
      // Test port allocation
      const ports = await findAvailablePorts();
      expect(ports).to.have.all.keys("postgresPort", "neo4jPort", "neo4jHttpPort");
      
      // Test database initialization
      await initializeContainerDB();
      expect(fs.existsSync(testDbFile)).to.be.true;
    });
  });
});
