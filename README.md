# fg-grants-platform-admin

[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_fg-grants-platform-admin&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=DEFRA_fg-grants-platform-admin)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_fg-grants-platform-admin&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=DEFRA_fg-grants-platform-admin)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=DEFRA_fg-grants-platform-admin&metric=coverage)](https://sonarcloud.io/summary/new_code?id=DEFRA_fg-grants-platform-admin)

Admin frontend for the Farming Grants platform. It has two areas:

- **Grant ops**: view an application's claims, and add or change its claimable items until a claim is made against them.
- **Dev ops**: browse platform events, applications and cases, and manage the access tokens other services call GAS and Caseworking with.

- [Running with other services](#running-with-other-services)
- [Requirements](#requirements)
  - [Node.js](#nodejs)
- [Server-side Caching](#server-side-caching)
- [Redis](#redis)
- [Local Development](#local-development)
  - [Setup](#setup)
  - [Development](#development)
  - [Production](#production)
  - [Npm scripts](#npm-scripts)
  - [Update dependencies](#update-dependencies)
  - [Formatting](#formatting)
    - [Windows prettier issue](#windows-prettier-issue)
- [Docker](#docker)
  - [Development image](#development-image)
  - [Production image](#production-image)
  - [Docker Compose](#docker-compose)
  - [Dependabot](#dependabot)
  - [SonarCloud](#sonarcloud)
- [Licence](#licence)
  - [About the licence](#about-the-licence)

## Running with other services

fg-grants-platform-admin needs fg-gas-backend (and the Entra stub to sign in) to do anything useful, so the easiest way to run it is
with the rest of Farming Grants: check out [fg-grants-core](https://github.com/DEFRA/fg-grants-core) alongside this repo and run
`npm run stack cw` there. fg-grants-core runs the shared infrastructure and
wires the services together.

This repo's own `compose.yml` only runs redis and this service. To work on it
without fg-grants-core, run what it calls separately and start this service
with `npm run dev` (see [Local Development](#local-development)).

Both ways use this repo's `compose/compose.platform-admin.yml`, so:

- Container env goes in the `environment:` block of `compose/compose.platform-admin.yml`.
  `.env` is for running node on your machine.
- Values that only make sense in the full stack, such as other services' URLs
  and tokens, stay in fg-grants-core's `compose/compose.override.yml`.
- Keep the infrastructure versions in `compose.yml` the same as
  fg-grants-core's. `npm run stack` there warns when they differ.

## Requirements

### Node.js

Please install Node Version Manager [nvm](https://github.com/creationix/nvm)

To use the correct version of Node.js for this application, via nvm:

```bash
cd fg-grants-platform-admin
nvm use
```

## Server-side Caching

We use Catbox for server-side caching. By default the service will use CatboxRedis when deployed and CatboxMemory for
local development.
You can override the default behaviour by setting the `SESSION_CACHE_ENGINE` environment variable to either `redis` or
`memory`.

Please note: CatboxMemory (`memory`) is _not_ suitable for production use! The cache will not be shared between each
instance of the service and it will not persist between restarts.

## Redis

Redis is an in-memory key-value store. Every instance of a service has access to the same Redis key-value store similar
to how services might have a database (or MongoDB). All frontend services are given access to a namespaced prefixed that
matches the service name. e.g. `my-service` will have access to everything in Redis that is prefixed with `my-service`.

If your service does not require a session cache to be shared between instances or if you don't require Redis, you can
disable setting `SESSION_CACHE_ENGINE=false` or changing the default value in `src/common/config.ts`.

## Proxy

We are using forward-proxy which is set up by default. To make use of this: `import { fetch } from 'undici'` then
because of the `setGlobalDispatcher(new ProxyAgent(proxyUrl))` calls will use the ProxyAgent Dispatcher

If you are not using Wreck, Axios or Undici or a similar http that uses `Request`. Then you may have to provide the
proxy dispatcher:

To add the dispatcher to your own client:

```javascript
import { ProxyAgent } from 'undici'

return await fetch(url, {
  dispatcher: new ProxyAgent({
    uri: proxyUrl,
    keepAliveTimeout: 10,
    keepAliveMaxTimeout: 10
  })
})
```

## Local Development

### Setup

Install application dependencies:

```bash
npm install
```

### Git hooks

`npm install` sets up the git hooks via husky. On each commit the pre-commit hook:

- runs eslint, prettier and stylelint on staged files only (via lint-staged), fixing what it can
- runs `npm run security-audit`, `npm run typecheck` and `npm test`

### Development

To run the application in `development` mode run:

```bash
npm run dev
```

### Production

To mimic the application running in `production` mode locally run:

```bash
npm start
```

### Signing in locally

Local sign-in runs against
[fg-entra-stub-frontend](https://github.com/DEFRA/fg-entra-stub-frontend) rather
than Entra ID. The stub:

- ignores `response_mode`, always returning the code on a query redirect rather
  than the cross-site `form_post` a deployed environment gets
- pins its `authorization_endpoint` to `localhost`, so the browser leg is always
  same-site with the app and `SameSite` is never exercised
- runs over plain HTTP, so `SESSION_COOKIE_SECURE` is off and the app itself
  falls back to the `query` response mode
- never verifies the PKCE `code_verifier`, binds `state` to the code, or echoes
  `nonce` into the id token

Its id token claims match, `roles` included, so anything about cookies or
redirects has to be checked on `dev`.

### Npm scripts

All available Npm scripts can be seen in [package.json](./package.json)
To view them in your command line run:

```bash
npm run
```

### Update dependencies

To update dependencies use [npm-check-updates](https://github.com/raineorshine/npm-check-updates):

> The following script is a good start. Check out all the options on
> the [npm-check-updates](https://github.com/raineorshine/npm-check-updates)

```bash
ncu --interactive --format group
```

### Dev Ops components

`src/dev-ops/views/components` is a copy of the design system's components
that the Dev Ops views use, with every class, custom property, element,
attribute and global prefixed `gpa`. It is never edited here: a change goes
to the design system, and the copy is taken again. To take it again (to
update it, or after views start using another component), run this from a
checkout of the design system at the commit to take (after `npm install` in
`source/parity`, for Prettier), then review the diff:

```bash
views=~/path/to/fg-grants-platform-admin/src/dev-ops/views
node source/add.cjs --views "$views" --to "$views" --prefix gpa
```

It writes `src/dev-ops/views/components` only. Its `manifest.json` records
the version, the commit, the prefix and a checksum for each file;
`node source/add.cjs --to "$views" --check` lists any file changed since it
was copied. The fonts' and icons' notices
are in `THIRD-PARTY-NOTICES`.

### Formatting

#### Windows prettier issue

If you are having issues with formatting of line breaks on Windows update your global git config by running:

```bash
git config --global core.autocrlf false
```

## Docker

### Development image

> [!TIP]
> For Apple Silicon users, you may need to add `--platform linux/amd64` to the `docker run` command to ensure
> compatibility fEx: `docker build --platform=linux/arm64 --no-cache --tag fg-grants-platform-admin`

Build:

```bash
docker build --target development --no-cache --tag fg-grants-platform-admin:development .
```

Run:

```bash
docker run -p 3000:3000 fg-grants-platform-admin:development
```

### Production image

Build:

```bash
docker build --no-cache --tag fg-grants-platform-admin .
```

Run:

```bash
docker run -p 3000:3000 fg-grants-platform-admin
```

### Docker Compose

`compose.yml` runs redis and this service:

```bash
docker compose up --build -d
```

It doesn't run fg-gas-backend or the Entra stub. To run them together use
fg-grants-core (see [Running with other services](#running-with-other-services)).

### Dependabot

We have added an example dependabot configuration file to the repository. You can enable it by renaming
the [.github/example.dependabot.yml](.github/example.dependabot.yml) to `.github/dependabot.yml`

### SonarCloud

Instructions for setting up SonarCloud can be found in [sonar-project.properties](./sonar-project.properties).

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government license v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.

## Synthetic test data

Customer identifiers, business names and agreement references in test fixtures are invented examples.
The `900000…` SBI/CRN values and `910000…` business references are generated
locally; they are not assigned or reserved RPA identifiers. No relationship to a
real customer is intended. Keep fixtures synthetic and coordinate shared examples
with consuming services. Explicit placeholders and validation boundary values may
remain in tests.
