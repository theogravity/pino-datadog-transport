import { HTTPLogItem } from '@datadog/datadog-api-client/dist/packages/datadog-api-client-v2/models/HTTPLogItem'

function generateCurrentPointer() {
  return Date.now() + '_' + Math.floor(Math.random() * 1000)
}

export class LogStorage {
  currentBucket: string
  private logBucket: Record<
    string,
    {
      size: number
      logItems: Array<HTTPLogItem>
    }
  >

  constructor() {
    this.logBucket = {}
    this.newLogBucket()
  }

  private newLogBucket() {
    if (this.currentBucket) {
      delete this.logBucket[this.currentBucket]
    }

    this.currentBucket = generateCurrentPointer()
    this.logBucket[this.currentBucket] = {
      size: 0,
      logItems: [],
    }
  }

  getLogBucketByteSize() {
    return this.logBucket[this.currentBucket].size
  }

  getLogCount() {
    return this.logBucket[this.currentBucket].logItems.length
  }

  finishLogBatch() {
    const logs = this.logBucket[this.currentBucket].logItems

    this.newLogBucket()

    return logs
  }

  addLog(log: HTTPLogItem, logByteSize: number) {
    this.logBucket[this.currentBucket].size += logByteSize
    this.logBucket[this.currentBucket].logItems.push(log)
  }
}
