# Contributing to SoulPeg

Thank you for your interest in contributing to SoulPeg! We welcome contributions from the community to help improve our protocol.

## How to Contribute

### Reporting Issues

If you find a bug or have a suggestion:
1. Check if the issue already exists
2. Create a new issue with a clear title and description
3. Include steps to reproduce (for bugs)
4. Add relevant labels

### Security Issues

**IMPORTANT**: If you discover a security vulnerability, please DO NOT open a public issue. Instead:
- Email: security@soulpeg.com
- Use responsible disclosure practices
- Allow time for the issue to be addressed before public disclosure

### Pull Requests

1. **Fork the repository**
   ```bash
   git clone https://github.com/soulpeg/soulpeg-contracts.git
   cd soulpeg-contracts
   ```

2. **Create a feature branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes**
   - Follow the coding standards
   - Add tests for new features
   - Update documentation as needed

4. **Run tests**
   ```bash
   npm test
   forge test
   ```

5. **Commit your changes**
   ```bash
   git commit -m "feat: add new feature"
   ```
   
   Follow conventional commits:
   - `feat:` new feature
   - `fix:` bug fix
   - `docs:` documentation changes
   - `test:` test additions/changes
   - `refactor:` code refactoring

6. **Push and create PR**
   ```bash
   git push origin feature/your-feature-name
   ```

### Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Install Foundry:
   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```

3. Set up environment:
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

### Coding Standards

- **Solidity Style**: Follow [Solidity Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html)
- **Comments**: Use NatSpec comments for all public functions
- **Testing**: Maintain 100% test coverage for new code
- **Gas Optimization**: Consider gas costs in your implementation

### Testing Guidelines

1. **Unit Tests**: Test individual functions
2. **Integration Tests**: Test contract interactions
3. **Fuzz Tests**: Add fuzz tests for complex logic
4. **Edge Cases**: Cover all edge cases

Example test structure:
```javascript
describe("Feature", () => {
  it("should handle normal case", async () => {
    // test implementation
  });
  
  it("should revert on invalid input", async () => {
    // test error cases
  });
});
```

### Documentation

- Update README.md if adding new features
- Add NatSpec comments to new functions
- Update integration guides if needed
- Keep CHANGELOG.md updated

### Review Process

1. All PRs require at least one review
2. Tests must pass
3. No decrease in test coverage
4. Follow security best practices
5. Gas optimization considered

### Code of Conduct

- Be respectful and constructive
- Help others in the community
- Focus on what's best for the project
- Welcome newcomers

## Getting Help

- Discord: https://discord.gg/soulpeg
- Documentation: https://docs.soulpeg.com
- GitHub Discussions: Use for questions

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

Thank you for contributing to SoulPeg! 🚀