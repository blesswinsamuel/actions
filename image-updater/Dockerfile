# Container image that runs your code
FROM node:19-alpine

COPY package.json yarn.lock /image-updater/

RUN yarn install --cwd /image-updater/

COPY index.js /image-updater/index.js

ENTRYPOINT ["node", "/image-updater/index.js"]
