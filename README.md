# pino-datadog-transport

[![NPM version](https://img.shields.io/npm/v/pino-datadog-transport.svg?style=flat-square)](https://www.npmjs.com/package/pino-datadog-transport)
[![CircleCI](https://circleci.com/gh/theogravity/node-pino-datadog-transport.svg?style=svg)](https://circleci.com/gh/theogravity/pino-datadog-transport)
![built with typescript](https://camo.githubusercontent.com/92e9f7b1209bab9e3e9cd8cdf62f072a624da461/68747470733a2f2f666c61742e62616467656e2e6e65742f62616467652f4275696c74253230576974682f547970655363726970742f626c7565)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)

A [pino v7+](https://github.com/pinojs/pino) transport for sending logs to [Datadog](https://datadog.com/).

It uses [datadog-api-client-typescript](https://github.com/DataDog/datadog-api-client-typescript) to
send logs using the client [v2.LogsApi#submitLog](https://datadoghq.dev/datadog-api-client-typescript/classes/v2.LogsApi.html) method.

- Performs batch sending of logs when the [log sending limits are approaching](https://docs.datadoghq.com/api/latest/logs/#send-logs).
- Will retry failed sends.
- Can disable batch sending and always send for each log entry.

## Table of Contents

<!-- TOC -->

- [Installation](#installation)
- [Configuration options](#configuration-options)
- [Implementing the `onError()` / `onDebug()` callback](#implementing-the-onerror--ondebug-callback)
- [Sending logs to Datadog with pino-socket instead](#sending-logs-to-datadog-with-pino-socket-instead)

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

```typescript
interface DDTransportOptions {
  /**
   * Datadog client configuration parameters.
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
  onError?: (err: any) => void
  /**
   * Define this callback to get debug messages from this transport
   */
  onDebug?: (msg: string) => void
  /**
   * Number of times to retry sending the log before onError() is called.
   * Default is 5.
   */
  retries?: number
  /**
   * Logs will be batched / queued until 4.9 MB (Datadog has a 5 MB limit per batch send) before
   * being sent. Define this interval in milliseconds to initiate sending regardless of
   * queue data size.
   *
   * Default is 3000 milliseconds.
   */
  sendIntervalMs?: number
  /**
   * Set to true to immediately send each new log entry to Datadog (disables batching).
   * This will result in a single request per log entry and disables the sendIntervalMs setting.
   */
  sendImmediate?: boolean
}
```

## Implementing the `onError()` / `onDebug()` callback

You cannot specify the callbacks directly as it is [not serializable](https://github.com/pinojs/pino-pretty#handling-non-serializable-options).

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
// Functions as options on the pino transport config are not serializable as they
// are workers, so we create this worker file which includes our callbacks

module.exports = (opts) => {
  return require('pino-datadog-logger')({
    ...opts,
    onError: (data) => {
      // Your error handling here
    }
  })
}
```

## Sending logs to Datadog with pino-socket instead

It is possible to send logs to Datadog using [raw TCP](https://docs.datadoghq.com/logs/log_collection/?tab=tcp) instead of HTTPS. Datadog
recommends HTTPS as the logs are compress-able, whereas TCP-sent logs are not.
HTTPS also has content length limits, whereas TCP does not.

Datadog recommends sending logs over HTTPS instead of raw TCP, as the latest
version of the Datadog agent uses HTTPS with a TCP fallback:

```
// https://docs.datadoghq.com/agent/logs/log_transport?tab=https
For Agent v6.19+/v7.19+, the default transport used for your logs is
compressed HTTPS instead of TCP for the previous versions.
When the Agent starts, if log collection is enabled, it runs a
HTTPS connectivity test. If successful, then the Agent uses
the compressed HTTPS transport, otherwise the Agent falls back to a TCP transport.
```

However, you can send logs using raw TCP + TLS using [`pino-socket`](https://github.com/pinojs/pino-socket).

See instructions [here](https://github.com/pinojs/pino/issues/1511#issuecomment-1207472871) on how to do this.
