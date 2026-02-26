module.exports = {
  apps: [{
    name: "pi-mom",
    cwd: "/Users/cai/Dev/pi-mono/packages/mom",
    script: "/bin/bash",
    args: "-c 'pnpm exec tsx src/main.ts /Users/cai/.pi/data'",
    env: {
      MCPORTER_CONFIG: "/Users/cai/.pi/mom/mcporter.json",
    },
  }],
};
