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
            hash = "sha256-1p0alKXU1lbCFyfOZjHH5WrzhZzpwZa/2UsUR/jxH4s=";
          };
        in
        {
          checks = {
            fmt = pkgs.stdenv.mkDerivation {
              inherit pnpmDeps;
              pname = "check-fmt";
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
                pnpm install --dev --frozen-store --offline --frozen-lockfile
                treefmt --ci
              '';
              installPhase = ''
                touch $out
              '';
            };

            lint = pkgs.stdenv.mkDerivation {
              inherit pnpmDeps;
              pname = "check-lint";
              version = "0";
              src = ./.;
              nativeBuildInputs = [
                nodejs-slim
                pnpm
                pkgs.pnpmConfigHook
              ];
              buildPhase = ''
                pnpm install --frozen-store --offline --frozen-lockfile
                pnpm run lint
              '';
              installPhase = ''
                touch $out
              '';
            };

            test = pkgs.stdenv.mkDerivation {
              inherit pnpmDeps;
              pname = "check-test";
              version = "0";
              src = ./.;
              nativeBuildInputs = [
                nodejs-slim
                pnpm
                pkgs.pnpmConfigHook
              ];
              buildPhase = ''
                pnpm install --frozen-store --offline --frozen-lockfile
                pnpm run test
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
              echo ""
            '';
          };
        };
    };
}
