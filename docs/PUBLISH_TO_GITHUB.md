# Publish as a new GitHub repository

A separate GitHub repository should contain the **source code**, the reproducible download scripts and documentation, **not the raw historical trip files** (too large for git). After unzipping this package:

## Option A: GitHub CLI installed

```bash
cd santander-cycles-network
# Install gh if needed: https://cli.github.com/
gh auth login  # skip if already authenticated
git init -b main
git add .
git commit -m "Build Santander Cycles network analysis pipeline"
gh repo create santander-cycles-network --private --source=. --remote=origin --push
```

## Option B: GitHub website

1. Create a new **empty** repository named `santander-cycles-network` at https://github.com/new (do not initialize README).
2. In Terminal, from the extracted folder:

```bash
git init -b main
git add .
git commit -m "Build Santander Cycles network analysis pipeline"
git remote add origin https://github.com/aleetreny/santander-cycles-network.git
git push -u origin main
```

`data/manifest.json`, `data/raw/`, `data/processed/`, `data/stations/` and `outputs/` are deliberately excluded by `.gitignore`. When publishing figures or an example subset later, explicitly review licence/size before adding them.
