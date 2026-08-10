import { IsUUID } from 'class-validator';

export class UiuxContentDto {
  @IsUUID()
  projectId: string;
}
