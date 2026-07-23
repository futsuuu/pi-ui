# Welcome to React Router!

A modern, production-ready template for building full-stack React applications using React Router.

[![Open in StackBlitz](https://developer.stackblitz.com/img/open_in_stackblitz.svg)](https://stackblitz.com/github/remix-run/react-router-templates/tree/main/default)

## Features

- 🚀 Server-side rendering
- ⚡️ Hot Module Replacement (HMR)
- 📦 Asset bundling and optimization
- 🔄 Data loading and mutations
- 🔒 TypeScript by default
- 🎉 TailwindCSS for styling
- 📖 [React Router docs](https://reactrouter.com/)

## Prerequisites

- [Nix](https://nixos.org/download) with flakes enabled
- (Optional) [direnv](https://direnv.net/) for automatic shell activation

## Getting Started

### Using Nix (recommended)

Enter the development shell:

```bash
nix develop
```

Inside the shell, install dependencies and start the dev server:

```bash
pnpm install
pnpm dev
```

Your application will be available at `http://localhost:5173`.

### Using direnv

If you have direnv installed, allow it to automatically load the Nix environment:

```bash
direnv allow
```

Then every time you enter the project directory, Node.js and pnpm will be automatically available.

### Manual installation (without Nix)

Install the dependencies:

```bash
pnpm install
```

### Development

Start the development server with HMR:

```bash
pnpm dev
```

Your application will be available at `http://localhost:5173`.

## Building for Production

Create a production build:

```bash
pnpm build
```

## Deployment

Make sure to deploy the output of `pnpm build`:

```
├── package.json
├── pnpm-lock.yaml
├── build/
│   ├── client/    # Static assets
│   └── server/    # Server-side code
```

## Styling

This template comes with [Tailwind CSS](https://tailwindcss.com/) already configured for a simple default starting experience. You can use whatever CSS framework you prefer.

---

Built with ❤️ using React Router.
