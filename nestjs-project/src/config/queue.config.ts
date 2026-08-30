import { registerAs } from '@nestjs/config';

export default registerAs('queue', () => ({
  rabbitmqUrl: process.env.RABBITMQ_URL!,
  videoProcessingQueue:
    process.env.RABBITMQ_VIDEO_PROCESSING_QUEUE || 'video_processing',
}));
