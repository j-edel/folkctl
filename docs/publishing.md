# Publishing plan

## 1. Finalize repository metadata

Confirm repository ownership in these files:

- `package.json`: `repository.url`, `bugs.url`, `homepage`
- `skills/folk-cli/SKILL.md`: `metadata.openclaw.homepage`
- `README.md`: clone URL

Suggested first release checklist:

```bash
npm run ci
node bin/folkctl.js api ls
node bin/folkctl.js people create --first-name Ada --last-name Lovelace --dry-run
```

## 2. Push to GitHub

Start private while the CLI and skill harden, then make the repository public when the first release is ready. Using the GitHub CLI:

```bash
git init
git add .
git commit -m "Initial folkctl CLI and OpenClaw skill"
gh repo create j-edel/folkctl --private --source=. --remote=origin --push
```

Without `gh`:

```bash
git init
git add .
git commit -m "Initial folkctl CLI and OpenClaw skill"
git remote add origin git@github.com:j-edel/folkctl.git
git push -u origin main
```

## 3. Tag a release

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 4. Publish or install the CLI

Initial GitHub-based install:

```bash
npm install -g github:j-edel/folkctl
```

Optional npm package later:

```bash
npm login
npm publish --access public
npm install -g folkctl
```

## 5. Publish to ClawHub

Install and authenticate the ClawHub CLI, then publish the skill folder:

```bash
npm install -g clawhub
clawhub login
clawhub skill publish skills/folk-cli \
  --slug folk-cli \
  --name "folk CLI" \
  --version 0.1.0 \
  --changelog "Initial open-source folk.app CLI skill" \
  --tags latest,crm,folk,openclaw,cli
```

After publication, OpenClaw users should be able to install it with:

```bash
openclaw skills search folk
openclaw skills install folk-cli
```

## 6. Maintainer release loop

For each release:

```bash
npm version patch
npm run ci
git push --follow-tags
clawhub skill publish skills/folk-cli --slug folk-cli --version $(node -p "require('./package.json').version") --changelog "Release notes here" --tags latest,crm,folk,openclaw,cli
```
