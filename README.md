# pino-datadog-transport

[![NPM version](https://img.shields.io/npm/v/pino-datadog-transport.svg?style=flat-square)](https://www.npmjs.com/package/pino-datadog-transport)
[![CircleCI](https://circleci.com/gh/theogravity/node-pino-datadog-transport.svg?style=svg)](https://circleci.com/gh/theogravity/pino-datadog-transport)
![built with typescript](https://camo.githubusercontent.com/92e9f7b1209bab9e3e9cd8cdf62f072a624da461/68747470733a2f2f666c61742e62616467656e2e6e65742f62616467652f4275696c74253230576974682f547970655363726970742f626c7565)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

A [pino v7+](https://github.com/pinojs/pino) transport for sending logs to [DataDog](https://datadog.com/).

It uses [datadog-api-client-typescript](https://github.com/DataDog/datadog-api-client-typescript) to
send logs using the client [v2.LogsApi#submitLog](https://datadoghq.dev/datadog-api-client-typescript/classes/v2.LogsApi.html) method.

<!-- TOC -->

- [Installation](#installation)
- [Configuration options](#configuration-options)
- [Implementing the `onError()` callback](#implementing-the-onerror-callback)

<!-- TOC END -->

## Installation

`yarn add pino-datadog-transport`

```typescript
import { LoggerOptions, pino } from 'pino';

const pinoConf: LoggerOptions = {
  level: 'trace',
}

const logger = pino(pinoConf, pino.transport({
  target: 'pino-datadog-transport',
  options: {
    ddClientConf: {
      authMethods: {
        apiKeyAuth: <your datadog API key>
      }
    },
  }
}))
```

## Configuration options

```
interface DDTransportOptions {
  /**
   * DataDog client configuration parameters.
   * @see https://datadoghq.dev/datadog-api-client-typescript/interfaces/client.Configuration.html
   */
  ddClientConf: ConfigurationParameters
  /**
   * The integration name associated with your log: the technology from which
   * the log originated. When it matches an integration name, Datadog
   * automatically installs the corresponding parsers and facets.
   * @see https://docs.datadoghq.com/logs/log_collection/?tab=host#reserved-attributes
   */
  ddsource?: string
  /**
   * Comma separated tags associated with your logs. Ex: "env:prod,org:finance"
   */
  ddtags?: string
  /**
   * The name of the application or service generating the log events.
   * It is used to switch from Logs to APM, so make sure you define the same
   * value when you use both products.
   * @see https://docs.datadoghq.com/logs/log_collection/?tab=host#reserved-attributes
   */
  service?: string
  /**
   * Error handler for when the submitLog() call fails. See readme on how to
   * properly implement this callback.
   */
  onError?: (err: string) => void
}
```

## Implementing the `onError()` callback

You cannot specify the `onError()` callback directly as it is [not serializable](https://github.com/pinojs/pino-pretty#handling-non-serializable-options).

Doing so will result in the following error:

```
DOMException [DataCloneError]: (e)=>{
} could not be cloned.
```

Instead, you need to create another file that implements it:

```typescript
// Your logger file
const p = pino({}, pino.transport({
    target: join(__dirname, 'pino-datadog-logger.js'),
    options: {
      ddClientConf: {
        authMethods: {
          apiKeyAuth: <your datadog API key>
        }
      },
    }
  }))
```

```typescript
/* eslint-disable */
// pino-datadog-logger.js
// https://github.com/pinojs/pino-pretty#handling-non-serializable-options

module.exports = (opts) => {
  return require('pino-datadog-logger')({
    ...opts,
    onError: (data) => {
      // Your error handling here
    }
  })
}
```
