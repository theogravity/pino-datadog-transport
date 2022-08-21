import { HTTPLogItem } from '@datadog/datadog-api-client/dist/packages/datadog-api-client-v2/models/HTTPLogItem'
import { LogsApiSubmitLogRequest } from '@datadog/datadog-api-client/dist/packages/datadog-api-client-v2/apis/LogsApi'
import { ConfigurationParameters } from '@datadog/datadog-api-client/dist/packages/datadog-api-client-common/configuration'
import { v2 } from '@datadog/datadog-api-client'
import pRetry from 'p-retry'
import exitHook from 'exit-hook'
import { LogStorage } from './log-storage'

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
   * Datadog server config for the client.
   * @see https://github.com/DataDog/datadog-api-client-typescript/blob/1e1097c68a437894b482701ecbe3d61522429319/packages/datadog-api-client-common/servers.ts#L90
   */
  ddServerConf?: {
    /**
     * The datadog server to use. Default is datadoghq.com.
     * Other values could be:
     * - us3.datadoghq.com
     * - us5.datadoghq.com
     * - datadoghq.eu
     * - ddog-gov.com
     */
    site?: string
    subdomain?: string
    protocol?: string
  }
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
   * Called when the plugin is ready to process logs.
   */
  onInit?: () => void
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

interface SendLogOpts {
  apiInstance: v2.LogsApi
  logsToSend: Array<HTTPLogItem>
  bucketName: string
  options: DDTransportOptions
}

function sendLogs({ apiInstance, logsToSend, bucketName, options }: SendLogOpts) {
  pRetry(
    async () => {
      const params: LogsApiSubmitLogRequest = {
        body: logsToSend,
        contentEncoding: 'gzip',
      }

      const result = await apiInstance.submitLog(params)

      if (options.onDebug) {
        options.onDebug(`(${bucketName}) Sending ${logsToSend.length} logs to Datadog completed`)
      }

      return result
    },
    { retries: options.retries ?? 5 },
  ).catch((err) => {
    if (options.onError) {
      options.onError(err, logsToSend)
    }
  })
}

export function processLogBuilder(options: DDTransportOptions, apiInstance: v2.LogsApi) {
  const logStorage = new LogStorage()
  let timer = null

  if (!options.sendImmediate) {
    if (options.onDebug) {
      options.onDebug(`Configured to send logs every ${options.sendIntervalMs || FORCE_SEND_MS}ms`)
    }

    timer = setInterval(() => {
      const logCount = logStorage.getLogCount()
      const currentBucket = logStorage.currentBucket

      if (logCount > 0) {
        if (options.onDebug) {
          options.onDebug(`(${currentBucket}) Sending ${logCount} logs to Datadog on timer`)
        }

        // ...logItems is so if we clear logItems in another run, we won't lose these logs
        sendLogs({
          apiInstance: apiInstance,
          logsToSend: logStorage.finishLogBatch(),
          bucketName: currentBucket,
          options: options,
        })
      }
    }, options.sendIntervalMs || FORCE_SEND_MS)
  }

  if (options.onDebug) {
    options.onDebug('Configuring exit hook')
  }

  exitHook(() => {
    if (logStorage.getLogCount() > 0) {
      // Attempt to send logs on an exit call
      if (options.onDebug) {
        options.onDebug(`Shutdown detected. Attempting to send remaining logs to Datadog`)
      }

      if (timer) {
        clearInterval(timer)
      }

      const currentBucket = logStorage.currentBucket

      sendLogs({
        apiInstance: apiInstance,
        logsToSend: logStorage.finishLogBatch(),
        bucketName: currentBucket,
        options: options,
      })
    }
  })

  if (options.onInit) {
    options.onInit()
  }

  return async function processLogs(source) {
    for await (const obj of source) {
      if (!obj) {
        if (options.onDebug) {
          options.onDebug('Log source object is empty')
        }

        return
      }

      // Datadog uses the date field for timestamp
      obj.date = obj.time
      delete obj.time

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

      if (options.sendImmediate) {
        if (options.onDebug) {
          options.onDebug(`(send-immediate) Sending log to Datadog`)
        }

        // Don't go through the batch logger if sendImmediate is enabled
        sendLogs({
          apiInstance: apiInstance,
          logsToSend: [logItem],
          bucketName: 'send-immediate',
          options: options,
        })

        continue
      }

      logStorage.addLog(logItem, logEntryLength)

      const logCount = logStorage.getLogCount()
      const shouldSend = logStorage.getLogBucketByteSize() > LOGS_PAYLOAD_SIZE_LIMIT || logCount > MAX_LOG_ITEMS

      if (shouldSend) {
        // Get the bucket name into a variable as finishLogBatch() generates a new one
        const currentBucket = logStorage.currentBucket

        if (options.onDebug) {
          options.onDebug(`(${currentBucket}) Sending ${logCount} logs to Datadog`)
        }

        sendLogs({
          apiInstance: apiInstance,
          logsToSend: logStorage.finishLogBatch(),
          bucketName: currentBucket,
          options: options,
        })
      }
    }
  }
}
