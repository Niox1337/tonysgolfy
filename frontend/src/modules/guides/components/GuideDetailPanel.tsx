import type { DuplicateGroup, GuideRecord } from '../../../api'

type GuideDetailPanelProps = {
  activeRecord: GuideRecord | null
  duplicateGroups: DuplicateGroup[]
}

export function GuideDetailPanel({ activeRecord, duplicateGroups }: GuideDetailPanelProps) {
  return (
    <aside className="panel side-panel">
      <div className="panel-heading">
        <div>
          <h2>球场细节</h2>
        </div>
      </div>

      {activeRecord ? (
        <div className="detail-card">
          <div className="detail-header">
            <div>
              <p className="eyebrow">精选球场</p>
              <h3>{activeRecord.courseName}</h3>
            </div>
            <span>¥{activeRecord.greenFee}</span>
          </div>
          <dl>
            <div>
              <dt>目的地</dt>
              <dd>{activeRecord.region}</dd>
            </div>
            <div>
              <dt>球场代号</dt>
              <dd>{activeRecord.courseCode}</dd>
            </div>
            <div>
              <dt>最佳季节</dt>
              <dd>{activeRecord.bestSeason || '待补充'}</dd>
            </div>
            <div>
              <dt>旅行备注</dt>
              <dd>{activeRecord.notes || '无'}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <p className="empty-state">请选择一条球场攻略。</p>
      )}

      <div className="subpanel">
        <div className="subpanel-heading">
          <h3>已录入内容的重复检查</h3>
          <span>{duplicateGroups.length} 组</span>
        </div>
        {duplicateGroups.length === 0 ? (
          <p className="empty-state">当前没有完全重复的球场攻略。</p>
        ) : (
          <ul className="duplicate-groups">
            {duplicateGroups.map((group) => (
              <li key={group.key}>
                <strong>{group.items[0].courseName}</strong>
                <span>
                  {group.items[0].region} · {group.items[0].courseCode} · {group.items.length} 条重复
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
