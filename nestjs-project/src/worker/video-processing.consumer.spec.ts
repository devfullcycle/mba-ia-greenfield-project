import { VideoProcessingConsumer } from './video-processing.consumer';

function makeContext(): any {
  const ack = jest.fn();
  const message = { fields: {}, properties: {}, content: Buffer.from('') };
  return {
    getChannelRef: () => ({ ack }),
    getMessage: () => message,
    ack,
    message,
  };
}

describe('VideoProcessingConsumer', () => {
  it('delegates to the service and acks the message once on success', async () => {
    const process = jest.fn().mockResolvedValue(undefined);
    const consumer = new VideoProcessingConsumer({ process } as any);
    const context = makeContext();

    await consumer.handleProcessing(
      { videoId: 'v1', originalKey: 'k1' },
      context,
    );

    expect(process).toHaveBeenCalledWith('v1', 'k1');
    expect(context.ack).toHaveBeenCalledTimes(1);
    expect(context.ack).toHaveBeenCalledWith(context.message);
  });

  it('still acks the message exactly once when the service throws (defensive path)', async () => {
    // VideoProcessingService.process() normally catches every internal
    // failure itself (status: erro) and never rejects — this covers the
    // pathological case where it does (e.g. the DB write itself fails).
    const process = jest.fn().mockRejectedValue(new Error('boom'));
    const consumer = new VideoProcessingConsumer({ process } as any);
    const context = makeContext();

    await expect(
      consumer.handleProcessing({ videoId: 'v1', originalKey: 'k1' }, context),
    ).rejects.toThrow('boom');
    expect(context.ack).toHaveBeenCalledTimes(1);
  });
});
