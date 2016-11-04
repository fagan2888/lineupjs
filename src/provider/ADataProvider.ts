/**
 * Created by Samuel Gratzl on 14.08.2015.
 */

import {isSupportType, IColumnDesc, Ranking, Column, models, createActionDesc, isNumberColumn, createStackDesc, createRankDesc, createSelectionDesc} from '../model';
import {IStatistics, ICategoricalStatistics} from '../model/Column';
import RankColumn from '../model/RankColumn';
import StackColumn from '../model/StackColumn';
import {ICategoricalColumn} from '../model/CategoricalColumn';
import {INumberColumn} from '../model/NumberColumn';
import {merge, AEventDispatcher, delayedCall} from '../utils';
import {set as d3set} from 'd3';

/**
 * a data row for rendering
 */
export interface IDataRow {
  /**
   * the value
   */
  v: any;
  /**
   * the underlying data index
   */
  dataIndex: number;
}

export interface IExportOptions {
  /**
   * export separator, default: '\t'
   */
  separator?: string;
  /**
   * new line character, default: '\n'
   */
  newline?: string;
  /**
   * should a header be generated, default: true
   */
  header?: boolean;
  /**
   * quote strings, default: false
   */
  quote?: boolean;
  /**
   * quote string to use, default: '"'
   */
  quoteChar?: string;
  /**
   * filter specific column types, default: exclude all support types (selection, action, rank)
   * @param col the column description to filter
   */
  filter?: (col: IColumnDesc)=>boolean; //!isSupportType
}

export interface IStatsBuilder {
  stats(col: INumberColumn): Promise<IStatistics>;
  hist(col: ICategoricalColumn): Promise<ICategoricalStatistics>;
}

export interface IDataProviderOptions {
  columnTypes?: { [columnType: string]: Column };
}


/**
 * a basic data provider holding the data and rankings
 */
abstract class ADataProvider extends AEventDispatcher {
  /**
   * all rankings
   * @type {Array}
   * @private
   */
  private rankings_: Ranking[] = [];
  /**
   * the current selected indices
   * @type {Set}
   */
  private selection = d3set();

  private uid = 0;

  /**
   * lookup map of a column type to its column implementation
   */
  columnTypes: any = merge({}, models());


  constructor(options: IDataProviderOptions = {}) {
    super();
    this.columnTypes = merge(models(), options.columnTypes || {});
  }

  /**
   * events:
   *  * column changes: addColumn, removeColumn
   *  * ranking changes: addRanking, removeRanking
   *  * dirty: dirty, dirtyHeder, dirtyValues
   *  * selectionChanged
   * @returns {string[]}
   */
  createEventList() {
    return super.createEventList().concat(['addColumn', 'removeColumn', 'addRanking', 'removeRanking', 'dirty', 'dirtyHeader', 'dirtyValues', 'orderChanged', 'selectionChanged']);
  }

  /**
   * returns a list of all known column descriptions
   * @returns {Array}
   */
  abstract getColumns(): IColumnDesc[];

  /**
   * adds a new ranking
   * @param existing an optional existing ranking to clone
   * @return the new ranking
   */
  pushRanking(existing?: Ranking): Ranking {
    const r = this.cloneRanking(existing);
    this.insertRanking(r);
    return r;
  }

  takeSnapshot(col: Column): Ranking {
    const r = this.cloneRanking();
    r.push(this.clone(col));
    this.insertRanking(r);
    return r;
  }

  insertRanking(r: Ranking, index = this.rankings_.length) {
    this.rankings_.splice(index, 0, r);
    this.forward(r, 'addColumn.provider', 'removeColumn.provider', 'dirty.provider', 'dirtyHeader.provider', 'orderChanged.provider', 'dirtyValues.provider');
    const that = this;
    //delayed reordering per ranking
    r.on('dirtyOrder.provider', delayedCall(function () {
      that.triggerReorder(this.source);
    }, 100, null));
    this.fire(['addRanking', 'dirtyHeader', 'dirtyValues', 'dirty'], r, index);
    this.triggerReorder(r);
  }

  protected triggerReorder(ranking: Ranking) {
    this.sort(ranking).then((order) => ranking.setOrder(order));
  }

  /**
   * removes a ranking from this data provider
   * @param ranking
   * @returns {boolean}
   */
  removeRanking(ranking: Ranking) {
    const i = this.rankings_.indexOf(ranking);
    if (i < 0) {
      return false;
    }
    this.unforward(ranking, 'addColumn.provider', 'removeColumn.provider', 'dirty.provider', 'dirtyHeader.provider', 'orderChanged.provider', 'dirtyOrder.provider', 'dirtyValues.provider');
    this.rankings_.splice(i, 1);
    ranking.on('dirtyOrder.provider', null);
    this.cleanUpRanking(ranking);
    this.fire(['removeRanking', 'dirtyHeader', 'dirtyValues', 'dirty'], ranking, i);
    return true;
  }

  /**
   * removes all rankings
   */
  clearRankings() {
    this.rankings_.forEach((ranking) => {
      this.unforward(ranking, 'addColumn.provider', 'removeColumn.provider', 'dirty.provider', 'dirtyHeader.provider', 'dirtyOrder.provider', 'dirtyValues.provider');
      ranking.on('dirtyOrder.provider', null);
      this.cleanUpRanking(ranking);
    });
    this.rankings_ = [];
    this.fire(['removeRanking', 'dirtyHeader', 'dirtyValues', 'dirty'], null);
  }

  /**
   * returns a list of all current rankings
   * @returns {Ranking[]}
   */
  getRankings() {
    return this.rankings_.slice();
  }

  /**
   * returns the last ranking for quicker access
   * @returns {Ranking}
   */
  getLastRanking() {
    return this.rankings_[this.rankings_.length - 1];
  }

  /**
   * hook method for cleaning up a ranking
   * @param ranking
   */
  cleanUpRanking(ranking: Ranking) {
    //nothing to do
  }

  /**
   * abstract method for cloning a ranking
   * @param existing
   * @returns {null}
   */
  abstract cloneRanking(existing?: Ranking): Ranking;

  /**
   * adds a column to a ranking described by its column description
   * @param ranking the ranking to add the column to
   * @param desc the description of the column
   * @return {Column} the newly created column or null
   */
  push(ranking: Ranking, desc: IColumnDesc): Column {
    const r = this.create(desc);
    if (r) {
      ranking.push(r);
      return r;
    }
    return null;
  }

  /**
   * adds a column to a ranking described by its column description
   * @param ranking the ranking to add the column to
   * @param index the position to insert the column
   * @param desc the description of the column
   * @return {Column} the newly created column or null
   */
  insert(ranking: Ranking, index: number, desc: IColumnDesc) {
    const r = this.create(desc);
    if (r) {
      ranking.insert(r, index);
      return r;
    }
    return null;
  }

  /**
   * creates a new unique id for a column
   * @returns {string}
   */
  private nextId() {
    return 'col' + (this.uid++);
  }

  protected abstract rankAccessor(row: any, id: string, desc: IColumnDesc, ranking: Ranking);

  private fixDesc(desc: IColumnDesc) {
    //hacks for provider dependent descriptors
    if (desc.type === 'rank') {
      (<any>desc).accessor = this.rankAccessor.bind(this);
    } else if (desc.type === 'selection') {
      (<any>desc).accessor = (row: any) => this.isSelected(row._index);
      (<any>desc).setter = (row: any, value: boolean) => value ? this.select(row._index) : this.deselect(row._index);
    }
  }

  /**
   * creates an internal column model out of the given column description
   * @param desc
   * @returns {Column] the new column or null if it can't be created
   */
  create(desc: IColumnDesc): Column {
    this.fixDesc(desc);
    //find by type and instantiate
    const type = this.columnTypes[desc.type];
    if (type) {
      return new type(this.nextId(), desc);
    }
    return null;
  }

  /**
   * clones a column by dumping and restoring
   * @param col
   * @returns {Column}
   */
  clone(col: Column) {
    const dump = this.dumpColumn(col);
    return this.restoreColumn(dump);
  }

  /**
   * restores a column from a dump
   * @param dump
   * @returns {Column}
   */
  restoreColumn(dump: any): Column {
    const create = (d: any) => {
      const desc = this.fromDescRef(d.desc);
      var type = this.columnTypes[desc.type];
      this.fixDesc(desc);
      var c = new type('', desc);
      c.restore(d, create);
      c.assignNewId(this.nextId.bind(this));
      return c;
    };
    return create(dump);
  }

  /**
   * finds a column in all rankings returning the first match
   * @param id_or_filter by id or by a filter function
   * @returns {Column}
   */
  find(id_or_filter: (col: Column) => boolean | string): Column {
    //convert to function
    const filter = typeof(id_or_filter) === 'string' ? (col) => col.id === id_or_filter : id_or_filter;

    for (let i = 0; i < this.rankings_.length; ++i) {
      let r = this.rankings_[i].find(filter);
      if (r) {
        return r;
      }
    }
    return null;
  }


  /**
   * dumps this whole provider including selection and the rankings
   * @returns {{uid: number, selection: number[], rankings: *[]}}
   */
  dump(): any {
    return {
      uid: this.uid,
      selection: this.selection.values().map(Number),
      rankings: this.rankings_.map((r) => r.dump(this.toDescRef))
    };
  }

  /**
   * dumps a specific column
   * @param col
   * @returns {any}
   */
  dumpColumn(col: Column) {
    return col.dump(this.toDescRef);
  }

  /**
   * for better dumping describe reference, by default just return the description
   * @param desc
   * @returns {any}
   */
  toDescRef(desc: any): any {
    return desc;
  }

  /**
   * inverse operation of toDescRef
   * @param descRef
   * @returns {any}
   */
  fromDescRef(descRef: any): any {
    return descRef;
  }

  private createHelper = (d: any) => {
    //factory method for restoring a column
    const desc = this.fromDescRef(d.desc);
    var c = null;
    if (desc && desc.type) {
      this.fixDesc(d.desc);
      let type = this.columnTypes[desc.type];
      c = new type(d.id, desc);
      c.restore(d, this.createHelper);
    }
    return c;
  };

  restoreRanking(dump: any) {
    const ranking = this.cloneRanking();
    ranking.restore(dump, this.createHelper);
    //if no rank column add one
    if (!ranking.children.some((d) => d instanceof RankColumn)) {
      ranking.insert(this.create(createRankDesc()), 0);
    }
    const idGenerator = this.nextId.bind(this);
    ranking.children.forEach((c) => c.assignNewId(idGenerator));

    return ranking;
  }

  restore(dump: any) {


    //clean old
    this.clearRankings();

    //restore selection
    this.uid = dump.uid || 0;
    if (dump.selection) {
      dump.selection.forEach((s) => this.selection.add(String(s)));
    }


    //restore rankings
    if (dump.rankings) {
      dump.rankings.forEach((r) => {
        var ranking = this.cloneRanking();
        ranking.restore(r, this.createHelper);
        //if no rank column add one
        if (!ranking.children.some((d) => d instanceof RankColumn)) {
          ranking.insert(this.create(createRankDesc()), 0);
        }
        this.insertRanking(ranking);
      });
    }
    if (dump.layout) { //we have the old format try to create it
      Object.keys(dump.layout).forEach((key) => {
        this.deriveRanking(dump.layout[key]);
      });
    }
    //assign new ids
    const idGenerator = this.nextId.bind(this);
    this.rankings_.forEach((r) => {
      r.children.forEach((c) => c.assignNewId(idGenerator));
    });
  }

  abstract findDesc(ref: string);

  /**
   * generates a default ranking by using all column descriptions ones
   */
  deriveDefault() {
    if (this.rankings_.length > 0) {
      //no default if we have a ranking
      return;
    }
    const r = this.pushRanking();
    this.getColumns().forEach((col) => {
      if (!isSupportType(col)) {
        this.push(r, col);
      }
    });
  }

  /**
   * derives a ranking from an old layout bundle format
   * @param bundle
   */
  private deriveRanking(bundle: any[]) {
    const ranking = this.cloneRanking();
    ranking.clear();
    const toCol = (column) => {
      if (column.type === 'rank') {
        return this.create(createRankDesc());
      }
      if (column.type === 'selection') {
        return this.create(createSelectionDesc());
      }
      if (column.type === 'actions') {
        let r = this.create(createActionDesc(column.label || 'actions'));
        r.restore(column, null);
        return r;
      }
      if (column.type === 'stacked') {
        //create a stacked one
        let r = <StackColumn>this.create(createStackDesc(column.label || 'Combined'));
        (column.children || []).forEach((col) => {
          let c = toCol(col);
          if (c) {
            r.push(c);
          }
        });
        return r;
      } else {
        let desc = this.findDesc(column.column);
        if (desc) {
          let r = this.create(desc);
          column.label = column.label || desc.label || desc.column;
          r.restore(column, null);
          return r;
        }
      }
      return null;
    };
    bundle.forEach((column) => {
      const col = toCol(column);
      if (col) {
        ranking.push(col);
      }
    });
    //if no rank column add one
    if (!ranking.children.some((d) => d instanceof RankColumn)) {
      ranking.insert(this.create(createRankDesc()), 0);
    }
    this.insertRanking(ranking);
    return ranking;
  }

  /**
   * sorts the given ranking and eventually return a ordering of the data items
   * @param ranking
   * @return {Promise<any>}
   */
  abstract sort(ranking: Ranking): Promise<number[]>;

  /**
   * returns a view in the order of the given indices
   * @param indices
   * @return {Promise<any>}
   */
  abstract view(indices: number[]): Promise<any[]>;

  fetch(orders: number[][]): Promise<IDataRow>[][] {
    return orders.map((order) => {
      const v = this.view(order);
      return order.map((d, i) => v.then((rows) => ({v:rows[i], dataIndex: d})));
    });
  }

  /**
   * returns a data sample used for the mapping editor
   * @param col
   * @return {Promise<any>}
   */
  abstract mappingSample(col: Column): Promise<number[]>;

  /**
   * helper for computing statistics
   * @param indices
   * @returns {{stats: (function(INumberColumn): *), hist: (function(ICategoricalColumn): *)}}
   */
  abstract stats(indices: number[]): IStatsBuilder;

  /**
   * method for computing the unique key of a row
   * @param row
   * @param i
   * @return {string}
   */
  rowKey(row: any, i: number) {
    return typeof(row) === 'number' ? String(row) : String(row._index);
  }


  /**
   * is the given row selected
   * @param index
   * @return {boolean}
   */
  isSelected(index: number) {
    return this.selection.has(String(index));
  }

  /**
   * also select the given row
   * @param index
   */
  select(index: number) {
    if (this.selection.has(String(index))) {
      return; //no change
    }
    this.selection.add(String(index));
    this.fire('selectionChanged', this.selection.values().map(Number));
  }

  /**
   * hook for selecting elements matching the given arguments
   * @param search
   * @param col
   */
  searchSelect(search: string|RegExp, col: Column) {
    //implemented by custom provider
  }

  /**
   * also select all the given rows
   * @param indices
   * @param jumpToSelection whether the first selected row should be visible
   */
  selectAll(indices: number[], jumpToSelection = false) {
    if (indices.every((i) => this.selection.has(String(i)))) {
      return; //no change
    }
    indices.forEach((index) => {
      this.selection.add(String(index));
    });
    this.fire('selectionChanged', this.selection.values().map(Number), jumpToSelection);
  }

  /**
   * set the selection to the given rows
   * @param indices
   * @param jumpToSelection whether the first selected row should be visible
   */
  setSelection(indices: number[], jumpToSelection = false) {
    if (this.selection.size() === indices.length && indices.every((i) => this.selection.has(String(i)))) {
      return; //no change
    }
    this.selection = d3set();
    this.selectAll(indices, jumpToSelection);
  }

  /**
   * toggles the selection of the given data index
   * @param index
   * @param additional just this element or all
   * @returns {boolean} whether the index is currently selected
   */
  toggleSelection(index: number, additional = false) {
    if (this.isSelected(index)) {
      if (additional) {
        this.deselect(index);
      } else {
        this.clearSelection();
      }
      return false;
    } else {
      if (additional) {
        this.select(index);
      } else {
        this.setSelection([index]);
      }
      return true;
    }
  }

  /**
   * deselect the given row
   * @param index
   */
  deselect(index: number) {
    if (!this.selection.has(String(index))) {
      return; //no change
    }
    this.selection.remove(String(index));
    this.fire('selectionChanged', this.selection.values().map(Number));
  }

  /**
   * returns a promise containing the selected rows
   * @return {Promise<any[]>}
   */
  selectedRows(): Promise<IDataRow[]> {
    if (this.selection.empty()) {
      return Promise.resolve([]);
    }
    return this.view(this.getSelection());
  }

  /**
   * returns the currently selected indices
   * @returns {Array}
   */
  getSelection() {
    var indices = [];
    this.selection.forEach((s) => indices.push(+s));
    indices.sort();
    return indices;
  }

  /**
   * clears the selection
   */
  clearSelection() {
    if (this.selection.empty()) {
      return; //no change
    }
    this.selection = d3set();
    this.fire('selectionChanged', [], false);
  }

  /**
   * utility to export a ranking to a table with the given separator
   * @param ranking
   * @param options
   * @returns {Promise<string>}
   */
  exportTable(ranking: Ranking, options: IExportOptions = {}) {
    const op: IExportOptions = {
      separator: '\t',
      newline: '\n',
      header: true,
      quote: false,
      quoteChar: '"',
      filter: (c) => !isSupportType(c)
    };
    options = merge(op, options);
    //optionally quote not numbers
    function quote(l: string, c?: Column) {
      if (op.quote && (!c || !isNumberColumn(c))) {
        return op.quoteChar + l + op.quoteChar;
      }
      return l;
    }

    const columns = ranking.flatColumns.filter((c) => op.filter(c.desc));
    return this.view(ranking.getOrder()).then((data) => {
      var r = [];
      if (op.header) {
        r.push(columns.map((d) => quote(d.label)).join(op.separator));
      }
      data.forEach((row) => {
        r.push(columns.map((c) => quote(c.getLabel(row), c)).join(op.separator));
      });
      return r.join(op.newline);
    });
  }

}

export default ADataProvider;
