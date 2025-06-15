#!/usr/bin/env node

/**
 * Environment Variable Validation Script
 *
 * This script validates that all required environment variables are properly
 * set and provides helpful feedback for missing or invalid configurations.
 */

const fs = require('fs');
const path = require('path');

// Colors for console output
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

// Helper function to colorize output
function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

// Load environment variables from .env file if it exists
function loadEnvFile() {
  const envPath = path.join(process.cwd(), '.env');

  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    const envLines = envContent.split('\n');

    envLines.forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0) {
          const value = valueParts.join('=').replace(/^["']|["']$/g, '');
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      }
    });

    console.log(colorize('✅ Loaded environment variables from .env file', 'green'));
    return true;
  } else {
    console.log(colorize('⚠️  No .env file found in current directory', 'yellow'));
    return false;
  }
}

// Required environment variables with descriptions
const requiredVars = [
  {
    name: 'REPO_URI',
    description: 'Git repository URI to analyze',
    example: 'git@github.com:your-org/your-repo.git',
    validator: (value) => {
      if (!value) return 'Value is required';
      if (!value.includes('github.com') && !value.startsWith('/')) {
        return 'Must be a GitHub URL or local path';
      }
      return null;
    }
  },
  {
    name: 'HOME',
    description: 'Home directory path',
    example: '/home/username or /root',
    validator: (value) => {
      if (!value) return 'Value is required';
      if (!path.isAbsolute(value)) {
        return 'Must be an absolute path';
      }
      return null;
    }
  },
  {
    name: 'GOOGLE_GENERATIVE_AI_API_KEY',
    description: 'Google Generative AI API key',
    example: 'AIza...',
    validator: (value) => {
      if (!value) return 'Value is required';
      if (!value.startsWith('AIza')) {
        return 'Should start with "AIza"';
      }
      if (value.length < 30) {
        return 'Seems too short for a valid API key';
      }
      return null;
    }
  },
  {
    name: 'ANTHROPIC_API_KEY',
    description: 'Anthropic Claude API key',
    example: 'sk-ant-api03-...',
    validator: (value) => {
      if (!value) return 'Value is required';
      if (!value.startsWith('sk-ant-')) {
        return 'Should start with "sk-ant-"';
      }
      if (value.length < 50) {
        return 'Seems too short for a valid API key';
      }
      return null;
    }
  },
  {
    name: 'CO_API_KEY',
    description: 'Cohere API key',
    example: 'your-cohere-api-key',
    validator: (value) => {
      if (!value) return 'Value is required';
      if (value.length < 20) {
        return 'Seems too short for a valid API key';
      }
      return null;
    }
  },
  {
    name: 'PINECONE_API_KEY',
    description: 'Pinecone vector database API key',
    example: 'pcsk_...',
    validator: (value) => {
      if (!value) return 'Value is required';
      if (!value.startsWith('pcsk_') && !value.startsWith('pc-')) {
        return 'Should start with "pcsk_" or "pc-"';
      }
      if (value.length < 30) {
        return 'Seems too short for a valid API key';
      }
      return null;
    }
  },
  {
    name: 'NEON_API_KEY',
    description: 'Neon database API key',
    example: 'napi_...',
    validator: (value) => {
      if (!value) return 'Value is required';
      if (!value.startsWith('napi_')) {
        return 'Should start with "napi_"';
      }
      if (value.length < 40) {
        return 'Seems too short for a valid API key';
      }
      return null;
    }
  }
];

// Optional environment variables with defaults
const optionalVars = [
  {
    name: 'GITHUB_PAT',
    description: 'GitHub Personal Access Token (required for private repos)',
    default: 'not set',
    validator: (value) => {
      if (value && !value.startsWith('ghp_') && !value.startsWith('github_pat_')) {
        return 'Should start with "ghp_" or "github_pat_"';
      }
      return null;
    }
  },
  {
    name: 'NODE_ENV',
    description: 'Node.js environment',
    default: 'development',
    validator: (value) => {
      const validValues = ['development', 'production', 'test'];
      if (value && !validValues.includes(value)) {
        return `Must be one of: ${validValues.join(', ')}`;
      }
      return null;
    }
  },
  {
    name: 'PORT',
    description: 'Application server port',
    default: '8080',
    validator: (value) => {
      if (value) {
        const port = parseInt(value, 10);
        if (isNaN(port) || port < 1 || port > 65535) {
          return 'Must be a valid port number (1-65535)';
        }
      }
      return null;
    }
  },
  {
    name: 'LOG_LEVEL',
    description: 'Logging level',
    default: 'info',
    validator: (value) => {
      const validLevels = ['error', 'warn', 'info', 'debug'];
      if (value && !validLevels.includes(value)) {
        return `Must be one of: ${validLevels.join(', ')}`;
      }
      return null;
    }
  },
  {
    name: 'NEO4J_URI',
    description: 'Neo4j connection URI',
    default: 'bolt://localhost:7687',
    validator: (value) => {
      if (value && !value.startsWith('bolt://') && !value.startsWith('neo4j://')) {
        return 'Should start with "bolt://" or "neo4j://"';
      }
      return null;
    }
  },
  {
    name: 'NEO4J_USERNAME',
    description: 'Neo4j username',
    default: 'neo4j'
  },
  {
    name: 'NEO4J_PASSWORD',
    description: 'Neo4j password',
    default: 'empty (no auth)'
  },
  {
    name: 'INDEX_FROM_SCRATCH',
    description: 'Rebuild knowledge graph from scratch',
    default: 'false',
    validator: (value) => {
      if (value && value !== 'true' && value !== 'false') {
        return 'Must be "true" or "false"';
      }
      return null;
    }
  }
];

// Validate environment variables
function validateEnvironment() {
  let hasErrors = false;
  let hasWarnings = false;

  console.log(colorize('\n🔍 Environment Variable Validation Report', 'bold'));
  console.log('='.repeat(50));

  // Check required variables
  console.log(colorize('\n📋 Required Variables:', 'blue'));

  requiredVars.forEach(varConfig => {
    const value = process.env[varConfig.name];
    const error = varConfig.validator ? varConfig.validator(value) : null;

    if (!value) {
      hasErrors = true;
      console.log(colorize(`❌ ${varConfig.name}`, 'red'));
      console.log(`   Description: ${varConfig.description}`);
      console.log(`   Example: ${varConfig.example}`);
      console.log('');
    } else if (error) {
      hasErrors = true;
      console.log(colorize(`❌ ${varConfig.name}`, 'red'));
      console.log(`   Value: ${value.substring(0, 20)}...`);
      console.log(`   Error: ${error}`);
      console.log('');
    } else {
      console.log(colorize(`✅ ${varConfig.name}`, 'green'));
      console.log(`   Value: ${value.substring(0, 20)}...`);
      console.log('');
    }
  });

  // Check optional variables
  console.log(colorize('⚙️  Optional Variables:', 'blue'));

  optionalVars.forEach(varConfig => {
    const value = process.env[varConfig.name];
    const error = varConfig.validator ? varConfig.validator(value) : null;

    if (error) {
      hasWarnings = true;
      console.log(colorize(`⚠️  ${varConfig.name}`, 'yellow'));
      console.log(`   Value: ${value || 'not set'}`);
      console.log(`   Warning: ${error}`);
      console.log('');
    } else {
      const displayValue = value || varConfig.default;
      const status = value ? '✅' : '🔧';
      console.log(colorize(`${status} ${varConfig.name}`, value ? 'green' : 'yellow'));
      console.log(`   Value: ${displayValue}`);
      console.log('');
    }
  });

  return { hasErrors, hasWarnings };
}

// Provide helpful suggestions
function provideSuggestions(hasErrors, hasWarnings) {
  console.log('='.repeat(50));

  if (hasErrors) {
    console.log(colorize('\n❌ Validation Failed', 'red'));
    console.log('\n💡 To fix the issues:');
    console.log('1. Create or edit your .env file:');
    console.log('   cp .env.template .env');
    console.log('   nano .env');
    console.log('\n2. Set all required environment variables');
    console.log('3. Check the ENVIRONMENT.md file for detailed instructions');
    console.log('4. Run this script again to validate');
  } else if (hasWarnings) {
    console.log(colorize('\n⚠️  Validation Passed with Warnings', 'yellow'));
    console.log('\n💡 Consider addressing the warnings above for optimal configuration');
  } else {
    console.log(colorize('\n✅ All Environment Variables Valid!', 'green'));
    console.log('\n🚀 Your application is ready to start');
  }
}

// Check if template file exists and provide guidance
function checkTemplateFile() {
  const templatePath = path.join(process.cwd(), '.env.template');

  if (fs.existsSync(templatePath)) {
    console.log(colorize('✅ .env.template file found', 'green'));
    return true;
  } else {
    console.log(colorize('⚠️  .env.template file not found', 'yellow'));
    console.log('💡 This file provides a template for environment variable configuration');
    return false;
  }
}

// Main execution
function main() {
  console.log(colorize('🔧 Code Graph RAG Environment Validator', 'bold'));
  console.log(colorize('This script validates your environment configuration\n', 'blue'));

  // Check for template file
  checkTemplateFile();

  // Load environment variables
  const envFileExists = loadEnvFile();

  if (!envFileExists) {
    console.log('\n💡 To create a .env file:');
    console.log('   cp .env.template .env');
    console.log('   # Edit .env with your actual values');
    console.log('   # Run this script again to validate\n');
  }

  // Validate environment
  const { hasErrors, hasWarnings } = validateEnvironment();

  // Provide suggestions
  provideSuggestions(hasErrors, hasWarnings);

  // Exit with appropriate code
  process.exit(hasErrors ? 1 : 0);
}

// Run the validator
if (require.main === module) {
  main();
} else {
  module.exports = { validateEnvironment, requiredVars, optionalVars };
}
