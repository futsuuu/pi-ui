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
            version = "0";
            src = ./.;
            fetcherVersion = 4;
            hash = "sha256-gzjHfltIAYg6dOxEJjhx00LEWfuc/sT1voxnfhOcjGg=";
          };
        in
        {
          packages = {
            pnpm-deps = pnpmDeps;
          };

          apps = {
            update-pnpm-hash =
              let
                app = pkgs.writeShellApplication {
                  name = "update-pnpm-hash";
                  runtimeInputs = [
                    pnpm
                    pkgs.nix-update
                  ];
                  text = ''
                    pnpm pkg set "devDependencies.playwright=${pkgs.playwright-driver.version}"
                    pnpm install --lockfile-only --ignore-scripts
                    nix-update pnpm-deps --flake --version=skip
                  '';
                };
              in
              {
                type = "app";
                program = "${app}/bin/update-pnpm-hash";
              };
          };

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
                pkgs.playwright-driver.browsers
                pkgs.git
              ];
              buildPhase = ''
                export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}
                export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
                export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true

                playwright_driver_version=${pkgs.playwright-driver.version}
                playwright_library_version=$(pnpm pkg get "devDependencies.playwright")
                if [ "$playwright_driver_version" != "$playwright_library_version" ]; then
                  echo "playwright driver version ($playwright_driver_version) does not match library version ($playwright_library_version)"
                  exit 1
                fi

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
              pkgs.playwright-driver.browsers
            ];

            shellHook = ''
              export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}
              export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
              export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=true

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
