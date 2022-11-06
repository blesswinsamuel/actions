const fetch = require("node-fetch");
const yaml = require("js-yaml");
const semver = require("semver");
const _ = require("lodash");
const fs = require("fs/promises");

async function doJSONRequest(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw await response.json();
  }
  return await response.json();
}

async function updateImages() {
  const commitMessages = [];
  const imageUpdaterConfig = yaml.load(
    await fs.readFile("./update-images.yaml", "utf8")
  );
  const { imageKey, semverKey, digestKey, versionUpdates } = imageUpdaterConfig;
  for (const fileConfig of versionUpdates) {
    const sourceFiles = fileConfig["sourceFiles"];
    const valuesContents = {};
    for (const fileName of sourceFiles) {
      const values = yaml.load(await fs.readFile(fileName, "utf8"));
      _.merge(valuesContents, values);
    }
    const outputFileName = fileConfig["outputFile"];

    for (const imageTagKey of fileConfig["imageTagKeys"]) {
      const requestedImage = _.get(
        valuesContents,
        imageTagKey + "." + imageKey
      );
      const requestedVersion = _.get(
        valuesContents,
        imageTagKey + "." + semverKey
      );
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
          const gitlabToken = await doJSONRequest(
            `https://gitlab.com/jwt/auth?service=container_registry&scope=repository:${repo}:pull`,
            { headers: { Authorization: "Basic " + gitlabBasicAuth } }
          )["token"];
          dockerApiUrl = `https://${registryUrl}/v2/${repo}`;
          headers = { Authorization: "Bearer " + gitlabToken };
          break;
      }

      const tags = await doJSONRequest(`${dockerApiUrl}/tags/list`, {
        headers: headers,
      })["tags"];

      const tag =
        semver.maxSatisfying(tags, requestedVersion) || requestedVersion;

      const digest = await doJSONRequest(`${dockerApiUrl}/manifests/${tag}`, {
        headers: headers,
      })["config"]["digest"];

      const versionsFile = yaml.load(await fs.readFile(outputFileName, "utf8"));
      const currentTag = _.get(versionsFile, imageTagKey + "." + semverKey);
      const currentDigest = _.get(versionsFile, imageTagKey + "." + digestKey);
      if (tag !== currentTag || digest != currentDigest) {
        _.set(versionsFile, imageTagKey + "." + semverKey, tag);
        _.set(versionsFile, imageTagKey + "." + digestKey, digest);
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
