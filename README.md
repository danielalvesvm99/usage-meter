# usage-meter

A band above the Claude Code prompt that shows:

- **Plan limits**: the 5-hour and weekly windows (and any per-model weekly limit), with reset times and a tick marking how much of each window has passed
- **Tokens**: this session's cache read, cache write, input and output, plus the estimated spend at API list price
- **System**: CPU, RAM, GPU (NVIDIA, via `nvidia-smi`) and free disk space, sampled every 15 seconds

`/usage-meter` shows or hides it. **compact** shrinks it to one line.

## Install

In a terminal Claude Code session (version 2.1.293 or later):

```
/plugin install usage-meter --marketplace danielalvesvm99/usage-meter
```

Answer `y` to add the marketplace, then pick the **user** scope so it loads in every session, including the Claude desktop app's Code tab.

## Requirements

- Claude Code 2.1.293 or later
- Plan limits appear only on a Claude subscription (Pro, Max, Team, Enterprise)
- System stats need Windows (PowerShell); the GPU meter needs an NVIDIA card. On other systems the system card says it is unavailable and the rest works.
