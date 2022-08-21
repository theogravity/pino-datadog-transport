import build from 'pino-abstract-transport'
import { client, v2 } from '@datadog/datadog-api-client'
import { DDTransportOptions, processLogBuilder } from './process-logs'

module.exports = function (options: DDTransportOptions) {
  const configuration = client.createConfiguration(options.ddClientConf)
  client.setServerVariables(configuration, options?.ddServerConf || {})
  const apiInstance = new v2.LogsApi(configuration)

  return build(processLogBuilder(options, apiInstance))
}
