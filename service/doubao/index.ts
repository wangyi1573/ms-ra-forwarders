import { randomBytes } from 'crypto';
import { WebSocket } from 'ws';

// 豆包TTS支持的音频格式映射（需根据实际接口调整）
export const DOUBAO_FORMAT_CONTENT_TYPE = new Map([
  ['mp3', 'audio/mpeg'],
  ['wav', 'audio/wav'],
  ['opus', 'audio/ogg; codecs=opus'],
]);

interface PromiseExecutor {
  resolve: (value?: Buffer) => void;
  reject: (reason?: any) => void;
}

export class DoubaoService {
  private ws: WebSocket | null = null;
  private executorMap: Map<string, PromiseExecutor>;
  private bufferMap: Map<string, Buffer>;
  private idleTimer: NodeJS.Timer | null = null;
  private cookie: string; // 豆包Cookie（从环境变量获取）

  constructor() {
    this.executorMap = new Map();
    this.bufferMap = new Map();
    // 从环境变量读取Cookie（部署时需配置，格式如："cookie1=xxx; cookie2=yyy"）
    this.cookie = process.env.DOUBAO_COOKIE || '';
    if (!this.cookie) {
      throw new Error('请配置豆包Cookie（环境变量 DOUBAO_COOKIE）');
    }
  }

  /**
   * 建立WebSocket连接（携带Cookie）
   */
  private async connect(): Promise<WebSocket> {
    const connectionId = randomBytes(16).toString('hex').toLowerCase();
    // 豆包TTS的WebSocket接口地址（需替换为实际地址）
    const url = `wss://tts.doubao.com/ws?connectionId=${connectionId}`;

    return new Promise((resolve, reject) => {
      // 连接时携带Cookie和必要的请求头
      const ws = new WebSocket(url, {
        headers: {
          'Cookie': this.cookie,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
          'Origin': 'https://doubao.com', // 需与豆包网站域名一致，否则可能跨域
        },
      });

      ws.on('open', () => {
        console.info('豆包WebSocket连接成功');
        resolve(ws);
      });

      ws.on('close', (code, reason) => {
        this.ws = null;
        if (this.idleTimer) {
          clearTimeout(this.idleTimer);
          this.idleTimer = null;
        }
        // 拒绝所有未完成的请求
        this.executorMap.forEach((executor) => {
          executor.reject(`连接已关闭: ${code} ${reason.toString()}`);
        });
        this.executorMap.clear();
        this.bufferMap.clear();
        console.info(`豆包连接关闭: ${code} ${reason.toString()}`);
      });

      ws.on('message', (message, isBinary) => {
        this.handleMessage(message, isBinary);
      });

      ws.on('error', (error) => {
        console.error('豆包连接错误:', error);
        reject(`连接失败: ${error.message}`);
      });
    });
  }

  /**
   * 处理WebSocket消息（需根据豆包接口格式调整）
   */
  private handleMessage(message: Buffer | string, isBinary: boolean) {
    const pattern = /X-RequestId:(?<id>[a-z0-9]*)/; // 假设消息头包含请求ID
    if (!isBinary) {
      // 文本消息：处理开始/结束标记
      const text = message.toString();
      if (text.includes('Path:turn.start')) {
        const matches = text.match(pattern);
        if (matches?.groups?.id) {
          const requestId = matches.groups.id;
          this.bufferMap.set(requestId, Buffer.from([]));
          console.debug(`豆包TTS开始传输: ${requestId}`);
        }
      } else if (text.includes('Path:turn.end')) {
        const matches = text.match(pattern);
        if (matches?.groups?.id) {
          const requestId = matches.groups.id;
          const executor = this.executorMap.get(requestId);
          if (executor) {
            const audioBuffer = this.bufferMap.get(requestId);
            executor.resolve(audioBuffer);
            this.executorMap.delete(requestId);
            this.bufferMap.delete(requestId);
            console.debug(`豆包TTS传输完成: ${requestId}`);
          }
        }
      }
    } else {
      // 二进制消息：拼接音频片段
      const data = message as Buffer;
      const separator = 'Path:audio\r\n';
      const contentIndex = data.indexOf(separator) + separator.length;
      if (contentIndex <= separator.length) return; // 无效格式

      const headers = data.slice(0, contentIndex).toString();
      const matches = headers.match(pattern);
      if (matches?.groups?.id) {
        const requestId = matches.groups.id;
        const audioChunk = data.slice(contentIndex);
        const buffer = this.bufferMap.get(requestId);
        if (buffer) {
          this.bufferMap.set(requestId, Buffer.concat([buffer, audioChunk]));
        }
      }
    }
  }

  /**
   * 文本转语音核心方法
   * @param text 待转换文本
   * @param format 音频格式（需在DOUBAO_FORMAT_CONTENT_TYPE中定义）
   */
  public async convert(text: string, format: string): Promise<Buffer> {
    // 验证格式
    if (!DOUBAO_FORMAT_CONTENT_TYPE.has(format)) {
      throw new Error(`不支持的音频格式: ${format}`);
    }

    // 确保连接有效
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.info('重新连接豆包TTS服务...');
      this.ws = await this.connect();
    }

    const requestId = randomBytes(16).toString('hex').toLowerCase();
    const result = new Promise<Buffer>((resolve, reject) => {
      this.executorMap.set(requestId, { resolve, reject });

      // 发送配置消息（需根据豆包接口要求调整格式）
      const config = {
        context: {
          synthesis: {
            audio: {
              outputFormat: format,
            },
          },
        },
      };
      const configMessage = `X-Timestamp:${new Date().toISOString()}\r\n` +
        'Content-Type:application/json\r\n' +
        'Path:config\r\n\r\n' +
        JSON.stringify(config);

      this.ws?.send(configMessage, (err) => {
        if (err) {
          reject(`配置发送失败: ${err.message}`);
          return;
        }

        // 发送文本消息（需根据豆包接口要求调整格式）
        const textMessage = `X-Timestamp:${new Date().toISOString()}\r\n` +
          `X-RequestId:${requestId}\r\n` +
          'Content-Type:text/plain\r\n' +
          'Path:text\r\n\r\n' +
          text;

        this.ws?.send(textMessage, (err) => {
          if (err) {
            reject(`文本发送失败: ${err.message}`);
          }
        });
      });
    });

    // 重置空闲计时器（10秒无请求则关闭连接）
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.close(1000, '空闲超时');
        console.info('豆包连接因空闲超时关闭');
      }
    }, 10000);

    // 超时控制（20秒未返回则失败）
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => {
        this.executorMap.delete(requestId);
        this.bufferMap.delete(requestId);
        reject('转换超时');
      }, 20000);
    });

    return Promise.race([result, timeout]) as Promise<Buffer>;
  }
}

export const doubaoService = new DoubaoService();
