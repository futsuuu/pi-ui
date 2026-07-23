{ inputs, ... }: {
  perSystem =
    { pkgs, system, ... }:
    let
      agentLib = inputs.agent-skills-nix.lib.agent-skills;

      sources = {
        react-router = {
          path = inputs.react-router;
          subdir = ".agents/skills";
        };
      };
      catalog = agentLib.discoverCatalog sources;
      allowlist = agentLib.allowlistFor {
        inherit catalog sources;
        enable = [ "react-router" ];
      };
      selection = agentLib.selectSkills {
        inherit catalog allowlist sources;
        skills = { };
      };
      bundle = agentLib.mkBundle { inherit pkgs selection; };
      targets = {
        agents = agentLib.defaultLocalTargets.agents // {
          enable = true;
        };
      };
    in
    {
      apps.skills-install-local = {
        type = "app";
        meta.description = "Install agent skills locally";
        program = "${
          agentLib.mkLocalInstallScript { inherit pkgs bundle targets; }
        }/bin/skills-install-local";
      };
      packages.skills-hook = pkgs.writeText "skills-hook" (
        agentLib.mkShellHook { inherit pkgs bundle targets; }
      );
    };
}
