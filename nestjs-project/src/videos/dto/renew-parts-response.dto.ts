import { UploadPartUrlDto } from './upload-part-url.dto';

export class RenewPartsResponseDto {
  /** One fresh presigned `PUT` URL per requested part. */
  parts: UploadPartUrlDto[];

  /** When the part URLs expire (ISO-8601). */
  expires_at: string;
}
