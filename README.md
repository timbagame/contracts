# Coinflip Contracts

A Solana smart contract implementation of a coin flip game using the Anchor framework.

## Prerequisites

- [Rust](https://rustup.rs/)
- [Solana CLI Tools](https://docs.solana.com/cli/install-solana-cli-tools)
- [Anchor](https://www.anchor-lang.com/)
- [Node.js](https://nodejs.org/) (v14 or higher)
- [Yarn](https://yarnpkg.com/)

## Installation

1. Install Solana:
```bash
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"
```

2. Install Anchor:
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --force
avm install latest
avm use latest
```

3. Install dependencies:
```bash
yarn install
```

## Building

Build the program:
```bash
anchor build
```

## Testing

Run the test suite:
```bash
anchor test
```

## Deployment

Deploy to your desired Solana cluster:
```bash
anchor deploy
```

Or use the migration script:
```bash
yarn run deploy
```

## Project Structure

```
coinflip-contracts/
├── programs/           # Smart contract source code
│   └── coinflip/      # Main program logic
├── tests/             # Test files
├── migrations/        # Deployment scripts
└── app/              # Client-side application (if applicable)
```

## License

[MIT License](LICENSE)

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Security

If you discover a security vulnerability, please send an e-mail to [your-email@example.com](mailto:your-email@example.com).
