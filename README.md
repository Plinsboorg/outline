<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./public/logos/outline-logo-dark.png" height="29">
    <source media="(prefers-color-scheme: light)" srcset="./public/logos/outline-logo-light.png" height="29">
    <img src="./public/logos/outline-logo-light.png" height="29" alt="Outline" />
  </picture>
</p>
<p align="center">
  <i>A fast, collaborative, knowledge base for your team built using React and Node.js.<br/>Try out Outline using our hosted version at <a href="https://www.getoutline.com">www.getoutline.com</a>.</i>
  <br/>
  <img width="1640" alt="screenshot" src="https://user-images.githubusercontent.com/380914/110356468-26374600-7fef-11eb-9f6a-f2cc2c8c6590.png">
</p>
<p align="center">
  <a href="http://www.typescriptlang.org" rel="nofollow"><img src="https://img.shields.io/badge/%3C%2F%3E-TypeScript-%230074c1.svg" alt="TypeScript"></a>
  <a href="https://github.com/styled-components/styled-components"><img src="https://img.shields.io/badge/style-%F0%9F%92%85%20styled--components-orange.svg" alt="Styled Components"></a>
  <a href="https://translate.getoutline.com/project/outline" alt="Localized"><img src="https://badges.crowdin.net/outline/localized.svg"></a>
</p>

---

## About this fork

`Plinsboorg/outline` is a fork of [Outline](https://github.com/outline/outline)
that adds **document databases**: typed properties on documents, and
table / board / list / gallery views over sets of them, embeddable inside any
document. If you have used Notion databases or Obsidian Bases, it is that,
built on Outline's documents.

This fork is **not affiliated with or endorsed by General Outline, Inc.**
[Upstream PR #13210](https://github.com/outline/outline/pull/13210), which
proposed the feature, was declined as too large to review in one piece. The
long-term intent is to split it into reviewable changes and propose them
upstream again; until that happens, this fork is the only place the feature
exists.

### What it adds

- **Document properties** — typed fields on a document (text, number, select,
  multi-select, date, person, checkbox, URL, relation, rollup), edited inline
  at the top of the document, and imported/exported as Markdown frontmatter.
- **Databases** — a database is a facet of a document, so every row is itself a
  real Outline document with its own body, permissions, history and search.
- **Views** — table, board, list and gallery layouts; saved views per database
  with their own filters, sorts, grouping, column order, widths and footer
  summaries.
- **Embedded databases** — drop a database into any document. An embed renders
  through the same view component as the database page, and can narrow the
  saved view with its own filters and column settings, restrict which views it
  offers, and be locked read-only independently of the source.
- **Rows in the sidebar**, sub-items, drag-to-reorder, and drag in and out of a
  database.

The feature is enabled by default and can be turned off per workspace under
**Settings → Details → Document databases**.

Design notes live in [`docs/document-databases-spec.md`](docs/document-databases-spec.md)
(the original RFC, kept for its rationale) and the phase task logs alongside it.

### Status

Usable and in daily use on a private instance, but young: it has not been
through a wide beta, the database APIs are not stable yet, and there is no
migration path promised between releases. Treat it as beta software and keep
backups. Bugs and feedback are welcome in this fork's issues — please do not
report fork-specific problems to upstream Outline.

### Running it

Container images are published per commit and per release:

```shell
docker pull ghcr.io/plinsboorg/outline:main
```

Otherwise the upstream [hosting documentation](https://docs.getoutline.com/s/hosting/)
applies unchanged — same environment variables, same Postgres and Redis, and
migrations run on boot. Building from source is the two-stage upstream build
(`Dockerfile.base`, then `Dockerfile`).

### Branches

| Branch | What it is |
| --- | --- |
| `main` | The fork: upstream plus the database work. Clone this. |
| `upstream-main` | An unmodified mirror of `outline/outline`'s `main`, for diffing. |

Upstream is **merged** into `main` periodically, never rebased, so `main` is
safe to track and is not force-pushed. `git diff upstream-main...main` is
always exactly this fork's changes.

### License

Unchanged from upstream: the [Business Source License 1.1](LICENSE), which
converts to Apache 2.0 on **2030-07-13**. A fork cannot relicense it, so the
same terms bind you — in particular the Additional Use Grant, which permits
self-hosting but not offering the software to third parties as a commercial
"Document Service". Read the [LICENSE](LICENSE) before deploying commercially.

---

This is the source code that runs [**Outline**](https://www.getoutline.com) and all the associated services. If you want to use Outline then you don't need to run this code, A hosted version of the app is offered at [getoutline.com](https://www.getoutline.com). You can also find documentation on using Outline in [our guide](https://docs.getoutline.com/s/guide).

If you'd like to run your own copy of Outline or contribute to development then this is the place for you.

# Installation

Please see the [documentation](https://docs.getoutline.com/s/hosting/) for running your own copy of Outline in a production configuration.

If you have questions or improvements for the docs please create a thread in [GitHub discussions](https://github.com/outline/outline/discussions).

# Contributing

> **Note:** Please do not submit AI-generated pull requests. We receive a high volume of mass, low-quality PRs generated by AI tools like Claude, ChatGPT, and Copilot from contributors who are unfamiliar with the codebase. These PRs are almost never mergeable and waste maintainer time reviewing them. If you’d like to contribute, please take the time to understand the codebase and write your changes thoughtfully.

Before submitting a pull request _you must_ discuss with the core team by creating or commenting in an issue on [GitHub](https://www.github.com/outline/outline/issues) – we’d also love to hear from you in the [discussions](https://www.github.com/outline/outline/discussions). This way we can ensure that an approach is agreed on before code is written and that you have read these instructions. This will result in a much higher likelihood of your code being accepted.

If you’re looking for ways to get started, here’s a list of ways to help us improve Outline:

- [Translation](docs/TRANSLATION.md) into other languages
- Issues with [`good first issue`](https://github.com/outline/outline/labels/good%20first%20issue) label
- Performance improvements, both on server and frontend
- Developer happiness and documentation
- Bugs, quality fixes, and other issues listed on GitHub

# Development

There is a short guide for [setting up a development environment](https://docs.getoutline.com/s/hosting/doc/local-development-5hEhFRXow7) if you wish to contribute changes, fixes, and improvements to Outline.

## Architecture

If you're interested in contributing or learning more about the Outline codebase
please refer to the [architecture document](docs/ARCHITECTURE.md) first for a high level overview of how the application is put together.

## Debugging

In development Outline outputs simple logging to the console, prefixed by categories. In production it outputs JSON logs, these can be easily parsed by your preferred log ingestion pipeline.

HTTP logging is disabled by default, but can be enabled by setting the `DEBUG=http` environment variable. logging
can be enabled for all categories by setting `DEBUG=*` or for specific categories such as `DEBUG=database` and `LOG_LEVEL=debug`, or `LOG_LEVEL=silly` for very verbose logging.

## Tests

We aim to have sufficient test coverage for critical parts of the application and aren't aiming for 100% unit test coverage. All API endpoints and anything authentication related should be thoroughly tested.

To add new tests, write your tests with [Vitest](https://vitest.dev/) and add a file with `.test.ts` extension next to the tested code.

```shell
# To run all tests
make test

# To run backend tests in watch mode
make watch
```

Once the test database is created with `make test` you may individually run
frontend and backend tests directly with vitest:

```shell
# To run backend tests
yarn test:server

# To run a specific backend test in watch mode
yarn test path/to/file.test.ts --watch

# To run frontend tests
yarn test:app
```

## Migrations

Sequelize is used to create and run migrations, for example:

```shell
yarn db:create-migration --name my-migration
yarn db:migrate
yarn db:rollback
```

Or, to run migrations on test database:

```shell
yarn db:migrate --env test
```

# Activity

![Alt](https://repobeats.axiom.co/api/embed/ff2e4e6918afff1acf9deb72d1ba6b071d586178.svg "Repobeats analytics image")

# License

Outline is [BSL 1.1 licensed](LICENSE).
