const fetch = require("node-fetch");
const yaml = require("js-yaml");
const semver = require("semver");
const _ = require("lodash");
const fs = require("fs/promises");

let report = `# Image updates\n\n`;

async function doJSONRequest(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw Error(`request failed (${url}): ${await response.text()}`);
  }
  try {
    return await response.json();
  } catch (err) {
    throw Error(`request failed (${url}): ${err}`);
  }
}

async function updateImages() {
  const commitMessages = [];
  const imageUpdaterConfig = yaml.load(await fs.readFile("./update-images.yaml", "utf8"));
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
      const requestedImage = _.get(valuesContents, imageTagKey + "." + imageKey);
      const requestedVersion = _.get(valuesContents, imageTagKey + "." + semverKey);
      const [registryUrl, ...repoParts] = requestedImage.split("/");
      const repo = repoParts.join("/");
      let dockerApiUrl = "";
      let headers = {};
      switch (registryUrl) {
        case "ghcr.io":
          const ghcrToken = process.env["GHCR_TOKEN"];
          dockerApiUrl = `https://${registryUrl}/v2/${repo}`;
          headers = {
            Authorization: "Bearer " + Buffer.from(ghcrToken).toString("base64"),
          };
          break;
        case "docker.io":
          const dockerIoToken = (
            await doJSONRequest(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`)
          )["token"];
          dockerApiUrl = `https://index.docker.io/v2/${repo}`;
          headers = {
            Authorization: "Bearer " + dockerIoToken,
          };
          break;
        case "registry.gitlab.com":
          const gitlabUsername = process.env["GITLAB_USERNAME"];
          const gitlabPassword = process.env["GITLAB_PASSWORD"];
          const gitlabBasicAuth = Buffer.from(gitlabUsername + ":" + gitlabPassword).toString("base64");
          const gitlabToken = (
            await doJSONRequest(
              `https://gitlab.com/jwt/auth?service=container_registry&scope=repository:${repo}:pull`,
              { headers: { Authorization: "Basic " + gitlabBasicAuth } }
            )
          )["token"];
          dockerApiUrl = `https://${registryUrl}/v2/${repo}`;
          headers = { Authorization: "Bearer " + gitlabToken };
          break;
      }

      const tags = (
        await doJSONRequest(`${dockerApiUrl}/tags/list`, {
          headers: headers,
        })
      )["tags"];
      const tag = semver.maxSatisfying(tags, requestedVersion) || requestedVersion;

      const digestObj = await doJSONRequest(`${dockerApiUrl}/manifests/${tag}`, {
        headers: {
          ...headers,
          Accept: "application/vnd.docker.distribution.manifest.v2+json",
        },
      });
      const digest = digestObj["config"]["digest"];
      // let digest = "unknown";
      // if ("config" in digestObj) {
      //   digest = digestObj["config"]["digest"];
      // } else {
      //   console.warn('Manifest missing for ');
      // }

      const versionsFile = yaml.load(await fs.readFile(outputFileName, "utf8"));
      const currentTag = _.get(versionsFile, imageTagKey + "." + semverKey);
      const currentDigest = _.get(versionsFile, imageTagKey + "." + digestKey);
      if (tag !== currentTag || digest !== currentDigest) {
        _.set(versionsFile, imageTagKey + "." + semverKey, tag);
        _.set(versionsFile, imageTagKey + "." + digestKey, digest);
        await fs.writeFile(outputFileName, yaml.dump(versionsFile));

        commitMessages.push(`Update ${imageTagKey} to ${tag} (${digest})`);
        const message = `${imageTagKey}: image tag/digest updated from ${repo}:${currentTag}:${currentDigest} to ${repo}:${tag}:${digest}`;
        console.log(message);
        report += `- ${message}\n`;
      } else {
        const message = `${imageTagKey}: no change in image tag/digest ${repo}:${tag}:${digest}`;
        console.log(message);
        report += `- ${message}\n`;
      }
    }
  }
  const commitMessage = commitMessages.join(", ");
  report += `\n\nCommit message: ${commitMessage}`;
  return commitMessage;
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
      await fs.writeFile(stepSmmaryFile, report);
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
