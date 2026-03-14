var config = {
  repositoryUrl: "https://github.com/chadbyte/clay.git",
  branches: [
    { name: "main", prerelease: "beta" },
    { name: "release" }
  ],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    ["@semantic-release/changelog", { changelogFile: "CHANGELOG.md" }],
    "@semantic-release/npm",
    ["@semantic-release/exec", {
      publishCmd: "node scripts/publish-alias.js ${nextRelease.version}"
    }],
    ["@semantic-release/git", {
      assets: ["package.json", "CHANGELOG.md"],
      message: "Release ${nextRelease.version}"
    }],
    "@semantic-release/github"
  ]
}

module.exports = config
