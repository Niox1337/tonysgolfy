import type { GuideRecord, SearchMode, SortMode } from '../../../api'

type GuideTablePanelProps = {
  searchTerm: string
  searchMode: SearchMode
  regionFilter: string
  sortMode: SortMode
  regionOptions: string[]
  records: GuideRecord[]
  selectedIds: string[]
  activeId: string | null
  isLoading: boolean
  allVisibleSelected: boolean
  onSearchTermChange: (value: string) => void
  onSearchModeChange: (value: SearchMode) => void
  onRegionFilterChange: (value: string) => void
  onSortModeChange: (value: SortMode) => void
  onSelectAll: () => void
  onDeleteSelected: () => Promise<void>
  onToggleSelect: (id: string) => void
  onActiveChange: (id: string) => void
  onStartEditing: (record: GuideRecord) => void
}

export function GuideTablePanel({
  searchTerm,
  searchMode,
  regionFilter,
  sortMode,
  regionOptions,
  records,
  selectedIds,
  activeId,
  isLoading,
  allVisibleSelected,
  onSearchTermChange,
  onSearchModeChange,
  onRegionFilterChange,
  onSortModeChange,
  onSelectAll,
  onDeleteSelected,
  onToggleSelect,
  onActiveChange,
  onStartEditing,
}: GuideTablePanelProps) {
  return (
    <section className="panel table-panel">
      <div className="panel-heading">
        <div>
          <h2>球场攻略表</h2>
        </div>
      </div>

      <div className="toolbelt">
        <label className="tool-field search-field">
          搜索
          <input
            value={searchTerm}
            onChange={(event) => onSearchTermChange(event.target.value)}
            placeholder="搜索球场、地区、季节或备注"
          />
        </label>
        <label className="tool-field">
          搜索方式
          <select value={searchMode} onChange={(event) => onSearchModeChange(event.target.value as SearchMode)}>
            <option value="keyword">关键词搜索</option>
            <option value="semantic">语义搜索</option>
          </select>
        </label>
        <label className="tool-field">
          Filter
          <select value={regionFilter} onChange={(event) => onRegionFilterChange(event.target.value)}>
            {regionOptions.map((region) => (
              <option key={region} value={region}>
                {region === 'all' ? '全部地区' : region}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="toolbar">
        <button className="ghost" type="button" onClick={onSelectAll}>
          {allVisibleSelected ? '取消全选' : '全选'}
        </button>
        <label className="tool-field toolbar-field toolbar-inline-field">
          <span>排序</span>
          <select value={sortMode} onChange={(event) => onSortModeChange(event.target.value as SortMode)}>
            <option value="updated-desc">最近更新</option>
            <option value="updated-asc">最早更新</option>
            <option value="fee-desc">果岭费从高到低</option>
            <option value="fee-asc">果岭费从低到高</option>
            <option value="name-asc">球场名称 A-Z</option>
          </select>
        </label>
        <button className="danger" type="button" onClick={onDeleteSelected} disabled={selectedIds.length === 0}>
          删除选中项 {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th aria-label="select"></th>
              <th>球场</th>
              <th>区域</th>
              <th>代号</th>
              <th>果岭费</th>
              <th>最佳季节</th>
              <th>综合评分</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const isSelected = selectedIds.includes(record.id)
              const isActive = activeId === record.id

              return (
                <tr
                  key={record.id}
                  className={isActive ? 'active-row' : undefined}
                  onClick={() => onActiveChange(record.id)}
                >
                  <td onClick={(event) => event.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggleSelect(record.id)}
                      aria-label={`select ${record.courseName}`}
                    />
                  </td>
                  <td>{record.courseName}</td>
                  <td>{record.region}</td>
                  <td>{record.courseCode}</td>
                  <td>¥{record.greenFee}</td>
                  <td>{record.bestSeason}</td>
                  <td>{record.compositeScore == null ? 'N/A' : record.compositeScore}</td>
                  <td>{new Date(record.updatedAt).toLocaleString()}</td>
                  <td onClick={(event) => event.stopPropagation()}>
                    <button className="ghost compact row-edit" type="button" onClick={() => onStartEditing(record)}>
                      修改
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {isLoading ? <div className="table-empty">正在加载球场攻略...</div> : null}
        {!isLoading && records.length === 0 ? (
          <div className="table-empty">当前搜索、筛选条件下没有匹配的球场攻略。</div>
        ) : null}
      </div>
    </section>
  )
}
