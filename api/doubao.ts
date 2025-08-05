import { Request, Response } from 'express';
import { decode } from 'js-base64';
import { doubaoService, DOUBAO_FORMAT_CONTENT_TYPE } from '../service/doubao';

module.exports = async (request: Request, response: Response) => {
  try {
    // 验证TOKEN（与项目现有授权机制保持一致）
    const token = request.headers.authorization?.split('Bearer ')[1];
    if (process.env.TOKEN && token !== process.env.TOKEN) {
      return response.status(401).json({ error: '未授权' });
    }

    // 解析请求参数
    const ttsData = request.query['data']?.toString() || '';
    const ttsDataStr = decode(decodeURIComponent(ttsData)) || '';
    const ttsArr = JSON.parse(ttsDataStr) || {};

    if (!ttsArr['ttsdata'] || !Array.isArray(ttsArr['ttsdata'])) {
      throw new Error('无效的ttsdata参数');
    }

    const result = [];
    for (const item of ttsArr['ttsdata']) {
      const text = decodeURIComponent(item['text']) || '';
      const format = item['voiceFormat'] || 'mp3';
      const name = decodeURIComponent(item['name']) || '豆包TTS';

      // 调用豆包TTS服务
      const audioBuffer = await doubaoService.convert(text, format);

      result.push({
        id: Date.now(),
        name,
        contentType: DOUBAO_FORMAT_CONTENT_TYPE.get(format),
        audioData: audioBuffer.toString('base64'),
      });
    }

    response.status(200).json(result);
  } catch (error) {
    console.error('豆包TTS接口错误:', error);
    response.status(500).json({ error: error.message || '转换失败' });
  }
};
