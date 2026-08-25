# DeepSeek Harness (Desktop & CLI)

<p align="center">
  <img src="apps/desktop/build/icon.png" width="128" height="128" alt="DeepSeek Harness Logo" />
</p>

<p align="center">
  <strong>An open-source, extensible Agent Harness platform where <em>Everything is a Plugin</em>.</strong>
</p>

<p align="center">
  <a href="https://github.com/moesuito/deepseek-harness/releases"><img src="https://img.shields.io/github/v/release/moesuito/deepseek-harness?style=flat-square&color=4D6BFE" alt="Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square" alt="License" /></a>
  <a href="https://deepseek.com"><img src="https://img.shields.io/badge/DeepSeek-AI-4D6BFE.svg?style=flat-square" alt="DeepSeek AI" /></a>
</p>

---

## 🖥️ DeepSeek Harness Desktop

This repository provides both the core **DeepSeek Harness (`dsh`)** platform and the **native Electron Desktop Application** (`deepseek-harness`) for **Linux** and **Windows**.

### Key Desktop Features
- 🚀 **Zero-Config Backend Management**: Automatically starts and manages the embedded `dsh` backend process in the background.
- 🎨 **Modern Native Interface**: Clean, dark-mode native window with official high-resolution DeepSeek branding and app icons.
- 🔄 **Clean Process Lifecycle**: Automatic graceful teardown of child background processes when closing the application.
- ⚡ **Cross-Platform**: Available as an installable `.deb` / `AppImage` for Linux and `.exe` (NSIS Installer) for Windows.

### 📥 Download Pre-built Desktop App

You can download the latest installers directly from the **[GitHub Releases](https://github.com/moesuito/deepseek-harness/releases)** page:

| Platform | Package Format | Download Link |
| :--- | :--- | :--- |
| **Linux (Ubuntu / Debian)** | `.deb` package | [Download .deb](https://github.com/moesuito/deepseek-harness/releases/latest) |
| **Windows (10 / 11)** | `.exe` installer | [Download .exe](https://github.com/moesuito/deepseek-harness/releases/latest) |

#### Linux Installation:
```bash
sudo dpkg -i deepseek-harness_0.1.1_amd64.deb
```
Once installed, search for **DeepSeek Harness** in your application launcher or launch from terminal:
```bash
deepseek-harness
```

---

## 🛠️ Run via CLI & Web

### Run from `npm` / `npx`
Install `Node.js >= 22`, then run:
```bash
npx @deepseek-ai/dsh web
```
The command starts the Web UI at `http://127.0.0.1:3080` by default.

### Run from Source
To run from this repository checkout:
```bash
git clone https://github.com/moesuito/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build

# Start the Web UI
pnpm dsh web

# Or launch the Electron Desktop App in development mode
cd apps/desktop && pnpm start
```

---

## 📦 Building Desktop Installers

To package the desktop application yourself:

```bash
cd apps/desktop
pnpm install

# Build Linux .deb package
pnpm run dist:deb

# Build Linux AppImage
pnpm run dist:appimage

# Build Windows .exe installer
pnpm run dist:win
```
The packaged installers will be generated inside `apps/desktop/release/`.

---

## 🧩 Architecture & Philosophy

DeepSeek Harness is powered by [Cordis](https://github.com/cordiverse/cordis), described in [*A Programming Paradigm for Spatiotemporal Composability*](https://github.com/cordiverse/paper). 

Every capability in the system is structured as an isolated, modular plugin:
- **Models**: Pluggable LLM backends (DeepSeek, OpenAI, Anthropic, local runners).
- **Tools & Skills**: Filesystem, bash/pwsh terminal execution, MCP client integration, session management.
- **Sessions & Storage**: Real-time context projection, conversation histories, and persistent workspaces.

For more technical details, refer to:
- [Development Guide](docs/development.md)
- [Architecture Documentation](docs/architecture.md)
- [Agent Guidance](AGENTS.md)

---

## 💬 Community and Support

- Submit feedback and questions through [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions).
- Add the [`dsh-plugin`](https://github.com/topics/dsh-plugin) topic to discover or share plugins.
- Join the [DeepSeek Harness Discord Community](https://discord.gg/Ycq5dCaS4).

---

## 📄 License

[MIT](LICENSE) © DeepSeek AI & Contributors.
