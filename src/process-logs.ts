import { HTTPLogItem } from '@datadog/datadog-api-client/dist/packages/datadog-api-client-v2/models/HTTPLogItem'
import { LogsApiSubmitLogRequest } from '@datadog/datadog-api-client/dist/packages/datadog-api-client-v2/apis/LogsApi'
import { ConfigurationParameters } from '@datadog/datadog-api-client/dist/packages/datadog-api-client-common/configuration'
import { v2 } from '@datadog/datadog-api-client'
import pRetry from 'p-retry'
import exitHook from 'exit-hook'

// Define log sending limits
// https://docs.datadoghq.com/api/latest/logs/#send-logs

// Use 4.9 MB instead of 5 MB to determine when to stop batching
const LOGS_PAYLOAD_SIZE_LIMIT = 5138022

// Use 0.95 MB instead of 1 MB to account for tags and other metadata
const LOG_SIZE_LIMIT = 996147

const FORCE_SEND_MS = 3000

const MAX_LOG_ITEMS = 995

export interface DDTransportOptions {
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
  onError?: (err: any, logs?: Array<Record<string, any>>) => void
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
   * Interval in which logs are sent to Datadog.
   * Default is 3000 milliseconds.
   */
  sendIntervalMs?: number
  /**
   * Set to true to disable batch sending and send each log as it comes in. This disables
   * the send interval.
   */
  sendImmediate?: boolean
}

export const convertLevel = (level: number | string): string => {
  if (typeof level === 'string') {
    return level
  }

  if (level == 60) {
    return 'fatal'
  }
  if (level >= 50) {
    return 'error'
  }
  if (level >= 40) {
    return 'warning'
  }
  if (level >= 30) {
    return 'log'
  }
  if (level >= 20) {
    return 'info'
  }

  return 'debug'
}

export function processLogBuilder(options: DDTransportOptions, apiInstance: v2.LogsApi) {
  let logItemsLength = 0
  let logItems = []
  let timer = null

  function sendLogs(logsToSend: Array<HTTPLogItem>) {
    logItems = []
    logItemsLength = 0

    pRetry(
      async () => {
        if (options.onDebug) {
          options.onDebug(`Sending ${logsToSend.length} logs to datadog`)
        }

        const params: LogsApiSubmitLogRequest = {
          body: logsToSend,
          contentEncoding: 'gzip',
        }

        try {
          const result = await apiInstance.submitLog(params)

          if (options.onDebug) {
            options.onDebug(`Sending ${logsToSend.length} logs to datadog completed`)
          }

          return result
        } catch (err) {
          throw {
            err,
            logs: logsToSend,
          }
        }
      },
      { retries: options.retries ?? 5 },
    ).catch(({ err, logs }) => {
      if (options.onError) {
        options.onError(err, logs)
      }
    })
  }

  if (!options.sendImmediate) {
    timer = setInterval(() => {
      if (logItems.length > 0) {
        // ...logItems is so if we clear logItems in another run, we won't lose these logs
        sendLogs([...logItems])
      }
    }, options.sendIntervalMs || FORCE_SEND_MS)
  }

  exitHook(() => {
    if (logItems.length > 0) {
      // Attempt to send logs on an exit call
      if (options.onDebug) {
        options.onDebug(`Shutdown detected. Attempting to send remaining logs to Datadog`)
      }

      if (timer) {
        clearInterval(timer)
      }

      sendLogs([...logItems])
    }
  })

  return async function processLogs(source) {
    for await (const obj of source) {
      if (!obj) {
        return
      }

      const logItem: HTTPLogItem = {
        message: JSON.stringify({
          ...obj,
          level: convertLevel(obj.level),
        }),
      }

      if (options.ddsource) {
        logItem.ddsource = options.ddsource
      }

      if (options.ddtags) {
        logItem.ddtags = options.ddtags
      }

      if (options.service) {
        logItem.service = options.service
      }

      if (obj.hostname) {
        logItem.hostname = obj.hostname
      }

      const logEntryLength =
        logItem.message.length +
        (logItem?.ddsource?.length || 0) +
        (logItem?.ddtags?.length || 0) +
        (logItem?.hostname?.length || 0) +
        (logItem?.service?.length || 0)

      if (logEntryLength > LOG_SIZE_LIMIT) {
        if (options.onError) {
          options.onError(new Error(`Log entry exceeds size limit of ${LOG_SIZE_LIMIT} bytes: ${logEntryLength}`), [
            logItem,
          ])
        }
      }

      logItems.push(logItem)
      logItemsLength += logEntryLength

      const shouldSend =
        options.sendImmediate || logItemsLength > LOGS_PAYLOAD_SIZE_LIMIT || logItems.length > MAX_LOG_ITEMS

      if (shouldSend) {
        sendLogs([...logItems])
      }
    }
  }
}
