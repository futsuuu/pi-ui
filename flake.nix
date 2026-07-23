{
  description = "Web UI for Pi Coding Agent";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs { inherit system; };

        nodejs = pkgs.nodejs_24;
        pnpm = pkgs.pnpm.override { inherit nodejs; };
      in
      {
        formatter = pkgs.writeShellApplication {
          name = "treefmt";
          runtimeInputs = [
            nodejs
            pnpm
            pkgs.nixfmt
            pkgs.treefmt
          ];
          text = ''
            exec treefmt "$@"
          '';
        };

        devShells.default = pkgs.mkShell {
          packages = [
            nodejs
            pnpm
            pkgs.treefmt
            pkgs.nixfmt
          ];

          shellHook = ''
            echo "Node.js : $(node --version)"
            echo "pnpm    : $(pnpm --version)"
            echo ""
            pnpm run
          '';
        };
      }
    );
}
