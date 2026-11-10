import { Test } from '@nestjs/testing';
import videoConfig from '../config/video.config';
import { VideoPublicIdService } from './video-public-id.service';
import { VIDEO_PUBLIC_ID_MIN_LENGTH } from './videos.constants';

const TEST_ALPHABET =
  'k3G7QAe51FCsPW92uEOyq4Bg6Sp8YzVTmnU0liwDdHXLajZrfxNbvtIRhcJMoK'
    .split('')
    .filter((char, index, chars) => chars.indexOf(char) === index)
    .join('');

describe('VideoPublicIdService', () => {
  let service: VideoPublicIdService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        VideoPublicIdService,
        {
          provide: videoConfig.KEY,
          useValue: {
            publicIdAlphabet: TEST_ALPHABET,
            reconcilerEnabled: false,
          },
        },
      ],
    }).compile();
    service = module.get(VideoPublicIdService);
  });

  it.each([1, 2, 1000, 2 ** 40])(
    'should encode seq %d to an id of at least the minimum length that decodes back',
    (seq) => {
      const publicId = service.encode(seq);

      expect(publicId.length).toBeGreaterThanOrEqual(
        VIDEO_PUBLIC_ID_MIN_LENGTH,
      );
      expect(service.decode(publicId)).toBe(seq);
    },
  );

  it('should produce distinct ids for distinct seqs', () => {
    const ids = new Set(
      Array.from({ length: 500 }, (_, index) => service.encode(index + 1)),
    );

    expect(ids.size).toBe(500);
  });

  it('should only use characters from the configured alphabet', () => {
    const publicId = service.encode(42);

    expect([...publicId].every((char) => TEST_ALPHABET.includes(char))).toBe(
      true,
    );
  });

  it('should return null for an id with characters outside the alphabet', () => {
    expect(service.decode('not-a-valid-id!')).toBeNull();
  });

  it('should return null for a non-canonical id that decodes to a different encoding', () => {
    const canonical = service.encode(7);
    const nonCanonical = canonical.slice(0, -1);

    expect(service.decode(nonCanonical)).toBeNull();
  });

  it('should return null for an id encoding more than one number', () => {
    const sqidsPair = service.encode(1) + service.encode(2);

    expect(service.decode(sqidsPair)).toBeNull();
  });
});
