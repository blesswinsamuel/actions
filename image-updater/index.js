const fetch = require("node-fetch");
const yaml = require("js-yaml");
const semver = require("semver");
const _ = require("lodash");
const fs = require("fs/promises");

async function updateImages() {
  const commitMessages = [];
  const imageUpdaterConfig = yaml.load(
    await fs.readFile("./update-images.yaml", "utf8")
  );
  const { imageKey, semverKey, versionUpdates } = imageUpdaterConfig;
  for (const [fileName, fileConfig] of Object.entries(versionUpdates)) {
    const valuesFile = yaml.load(await fs.readFile(fileName, "utf8"));
    const outputFileName = fileConfig["outputFile"];

    for (const imageTagKey of fileConfig["imageTagKeys"]) {
      const imageTagObj = _.get(valuesFile, imageTagKey);
      const requestedImage = imageTagObj[imageKey];
      const requestedVersion = imageTagObj[semverKey];
      const [registryUrl, ...repoParts] = requestedImage.split("/");
      const repo = repoParts.join("/");
      let dockerApiUrl = "";
      let headers = {};
      switch (registryUrl) {
        case "ghcr.io":
          const ghcrToken = process.env["GHCR_TOKEN"];
          dockerApiUrl = `https://${registryUrl}/v2/${repo}`;
          headers = {
            Authorization:
              "Bearer " + Buffer.from(ghcrToken).toString("base64"),
          };
          break;
        case "registry.gitlab.com":
          const gitlabUsername = process.env["INPUT_GITLAB-TOKEN"];
          const gitlabPassword = process.env["INPUT_GITLAB-TOKEN"];
          const gitlabBasicAuth = Buffer.from(
            gitlabUsername + ":" + gitlabPassword
          ).toString("base64");
          const gitlabJwtAuthResponse = await fetch(
            `https://gitlab.com/jwt/auth?service=container_registry&scope=repository:${repo}:pull`,
            { headers: { Authorization: "Basic " + gitlabBasicAuth } }
          );
          if (!response.ok) {
            throw await response.json();
          }
          const gitlabToken = (await gitlabJwtAuthResponse.json())["token"];
          dockerApiUrl = `https://${registryUrl}/v2/${repo}`;
          headers = { Authorization: "Bearer " + gitlabToken };
          break;
      }

      const response = await fetch(`${dockerApiUrl}/tags/list`, {
        headers: headers,
      });
      if (!response.ok) {
        throw await response.json();
      }
      const tags = (await response.json())["tags"];

      const tag = semver.maxSatisfying(tags, requestedVersion);

      const versionsFile = yaml.load(await fs.readFile(outputFileName, "utf8"));
      const currentTag = _.get(versionsFile, imageTagKey + ".tag");
      if (tag !== currentTag) {
        _.set(versionsFile, imageTagKey + ".tag", tag);
        await fs.writeFile(outputFileName, yaml.dump(versionsFile));

        console.log(
          `${imageTagKey}: image version updated from ${repo}:${currentTag} to ${repo}:${tag}`
        );
        commitMessages.push(`Update ${imageTagKey} to ${tag}`);
      } else {
        console.log(
          `${imageTagKey}: no change in image version ${repo}:${tag}`
        );
      }
    }
  }
  return commitMessages.join(", ");
}

module.exports = updateImages;

if (require.main === module) {
  async function main() {
    const commitMessage = await updateImages();
    const outputFile = process.env.GITHUB_OUTPUT;
    if (outputFile) {
      await fs.writeFile(outputFile, `commit-message=${commitMessage}`);
    }
    const stepSmmaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (outputFile) {
      await fs.writeFile(
        stepSmmaryFile,
        `${commitMessage.split(", ").join("\n")}`
      );
    }
  }
  main()
    .then(() => {
      console.log("Image updater successful");
    })
    .catch((err) => {
      console.error("Image updater error", err);
      // process.exit(1);
      process.exitCode = 1;
    });
}
