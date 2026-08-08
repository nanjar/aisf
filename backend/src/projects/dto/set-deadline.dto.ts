import { IsDateString } from 'class-validator';

export class SetProjectDeadlineDto {
  @IsDateString()
  deadlineAt: string;
}
