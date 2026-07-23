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
        "x86_64-darwin"
        "x86_64-linux"
      ];
      perSystem =
        { pkgs, system, ... }:
        let
          nodejs = pkgs.nodejs_24;
          pnpm = pkgs.pnpm.override { nodejs-slim = nodejs; };
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
              echo ""
              source ${self.packages.${system}.skills-hook}
            '';
          };
        };
    };
}
