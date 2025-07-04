# Environment Variables Configuration

## Required Environment Variables

These variables MUST be set for the application to function properly:

### AI Service API Keys

| Variable | Description | Where to Get |
|----------|-------------|--------------|
| `ANTHROPIC_API_KEY` | Anthropic Claude API key | [Anthropic Console](https://console.anthropic.com/) |
| `PINECONE_API_KEY` | Pinecone vector embedding API key | [Pinecone Console](https://app.pinecone.io/) |

## Environment Setup by Deployment Method

**Minimal `.env` for development:**

Add API keys for these services to `$HOME/.graphsense/.env`;
```env
ANTHROPIC_API_KEY=your-key-here
PINECONE_API_KEY=your-key-here
```

## Validation and Troubleshooting

### Environment Validation

The application automatically validates required environment variables on startup:

```bash
# Check environment configuration
npm run env:check

# Check application health
npm run health
```

## Support

For issues with environment configuration:

1. Check this documentation
2. Validate your `.env` file against `.env.template`
3. Run `npm run env:check` to validate configuration
4. Check application logs for specific error messages
5. Ensure all required services (Neo4j, Postgres with pgvector) are running
