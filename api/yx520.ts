import axios from 'axios';
import { Request, Response } from 'express';

export default async (request: Request, response: Response) => {
  try {
    const { voice, text } = request.query;

    // 验证必填参数
    if (!voice || !text) {
      return response.status(400).json({ error: '参数 voice 和 text 是必填项' });
    }

    // 调用外部接口
    const apiUrl = `http://www.yx520.ltd/API/api.php.php?voice=${voice}&text=${encodeURIComponent(text)}`;
    const apiResponse = await axios.get(apiUrl);

    // 返回结果
    response.status(200).json(apiResponse.data);
  } catch (error) {
    console.error('调用接口失败:', error);
    response.status(500).json({ error: '服务器内部错误' });
  }
};
