/**
 * Created by sam on 04.11.2016.
 */

import ValueColumn, {IValueColumnDesc} from './ValueColumn';
import {FIRST_IS_NAN, isMissingValue} from './missing';
import {timeFormat, timeParse} from 'd3-time-format';
import {IDataRow} from './interfaces';

export interface IDateDesc {
  /**
   * d3 formatting option
   * @default %x
   */
  readonly dateFormat?: string;

  /**
   * d3 formation option
   * @dfeault dateFormat
   */
  readonly dateParse?: string;
}

export declare type IDateColumnDesc = IValueColumnDesc<Date|string> & IDateDesc;

export default class DateColumn extends ValueColumn<Date|string> {
  private readonly format: (date: Date) => string;
  private readonly parse: (date: string) => Date | null;

  constructor(id: string, desc: IDateColumnDesc) {
    super(id, desc);
    this.format = timeFormat(desc.dateFormat || '%x');
    this.parse = desc.dateParse ? timeParse(desc.dateParse) : timeParse(desc.dateFormat || '%x');
    this.setDefaultRenderer('default');
  }

  getValue(row: IDataRow): Date|null {
    const v = super.getValue(row);
    if (isMissingValue(v)) {
      return null;
    }
    if (v instanceof Date) {
      return v;
    }
    return this.parse(String(v));
  }

  getLabel(row: IDataRow) {
    const v = this.getValue(row);
    if (!(v instanceof Date)) {
      return '';
    }
    return this.format(v);
  }

  compare(a: IDataRow, b: IDataRow) {
    const av = this.getValue(a);
    const bv = this.getValue(b);
    if (av === bv) {
      return 0;
    }
    if (!(av instanceof Date)) {
      return (bv instanceof Date) ? FIRST_IS_NAN : 0;
    }
    if (!(bv instanceof Date)) {
      return FIRST_IS_NAN * -1;
    }
    return av.getTime() - bv.getTime();
  }
}
