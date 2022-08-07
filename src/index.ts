import build from 'pino-abstract-transport'
import { client, v2 } from '@datadog/datadog-api-client'
import type { ConfigurationParameters } from '@datadog/datadog-api-client/dist/packages/datadog-api-client-common/configuration'
import type { LogsApiSubmitLogRequest } from '@datadog/datadog-api-client/dist/packages/datadog-api-client-v2/apis/LogsApi'
import { HTTPLogItem } from '@datadog/datadog-api-client/dist/packages/datadog-api-client-v2/models/HTTPLogItem'

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
  onError?: (err: string) => void
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

export default async function (options: DDTransportOptions) {
  const configuration = client.createConfiguration(options.ddClientConf)
  const apiInstance = new v2.LogsApi(configuration)

  return build(async function (source) {
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

      const params: LogsApiSubmitLogRequest = {
        body: [logItem],
        contentEncoding: 'gzip',
      }

      try {
        await apiInstance.submitLog(params)
      } catch (e) {
        if (options.onError) {
          options.onError(e)
        }
      }
    }
  })
}
