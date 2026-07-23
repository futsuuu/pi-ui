{
  description = "Web UI for Pi Coding Agent";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    agent-skills-nix = {
      url = "github:Kyure-A/agent-skills-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    react-router = {
      url = "github:remix-run/react-router";
      flake = false;
    };
  };

  outputs =
    { self, flake-parts, ... }@inputs:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [ ./.agents/skills.nix ];

      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      perSystem =
        { pkgs, system, ... }:
        let
          nodejs-slim = pkgs.nodejs-slim_26;
          pnpm = pkgs.pnpm.override { inherit nodejs-slim; };
          pnpmDeps = pkgs.fetchPnpmDeps {
            pname = "pnpm-deps";
            src = ./.;
            fetcherVersion = 4;
            hash = "sha256-zLGwmzYqYeL1Cr1GhQQLdWpm3Ci+dgY1ebBy87F4blc=";
          };
        in
        {
          checks = {
            treefmt = pkgs.stdenv.mkDerivation {
              inherit pnpmDeps;
              pname = "check-treefmt";
              version = "0";
              src = ./.;
              nativeBuildInputs = [
                nodejs-slim
                pnpm
                pkgs.pnpmConfigHook
                pkgs.nixfmt
                pkgs.treefmt
              ];
              buildPhase = ''
                pnpm install --frozen-store --offline --frozen-lockfile
                treefmt --ci
              '';
              installPhase = ''
                touch $out
              '';
            };
          };

          formatter = pkgs.writeShellApplication {
            name = "treefmt";
            runtimeInputs = [
              nodejs-slim
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
              nodejs-slim
              pnpm
              pkgs.treefmt
              pkgs.nixfmt
            ];

            shellHook = ''
              echo "Node.js : $(node --version)"
              echo "pnpm    : $(pnpm --version)"
              echo ""
              pnpm run
              echo ""
              source ${self.packages.${system}.skills-hook}
            '';
          };
        };
    };
}
