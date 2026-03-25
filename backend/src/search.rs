use std::collections::HashMap;

use crate::models::{
    DuplicateGroup, DuplicatePreviewMatch, GuideInput, GuideRecord, GuidesQuery, ImportAudit,
    SearchMode, SortMode,
};

pub fn normalize_value(value: &str) -> String {
    value.trim().to_lowercase()
}

pub fn validate_guide_input(input: &GuideInput) -> Result<(), String> {
    if input.course_name.trim().is_empty() {
        return Err("courseName is required".to_string());
    }

    if input.course_code.trim().is_empty() {
        return Err("courseCode is required".to_string());
    }

    Ok(())
}

pub fn build_fingerprint(course_name: &str, region: &str, course_code: &str) -> String {
    [course_name, region, course_code]
        .into_iter()
        .map(normalize_value)
        .collect::<Vec<_>>()
        .join("::")
}

pub fn fingerprint_for_record(record: &GuideRecord) -> String {
    build_fingerprint(&record.course_name, &record.region, &record.course_code)
}

pub fn fingerprint_for_input(input: &GuideInput) -> String {
    build_fingerprint(&input.course_name, &input.region, &input.course_code)
}

pub fn score_similarity_record_input(record: &GuideRecord, input: &GuideInput) -> f32 {
    let mut score = 0.0;

    if normalize_value(&record.course_name) == normalize_value(&input.course_name) {
        score += 0.4;
    }
    if normalize_value(&record.course_code) == normalize_value(&input.course_code) {
        score += 0.25;
    }
    if normalize_value(&record.region) == normalize_value(&input.region) {
        score += 0.15;
    }
    if normalize_value(&record.best_season) == normalize_value(&input.best_season) {
        score += 0.1;
    }

    let left_notes = normalize_value(&record.notes);
    let right_notes = normalize_value(&input.notes);
    if !left_notes.is_empty() && left_notes == right_notes {
        score += 0.1;
    }

    score
}

pub fn semantic_score(record: &GuideRecord, query: &str) -> f32 {
    let terms = normalize_value(query)
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();

    if terms.is_empty() {
        return 1.0;
    }

    let course_name = normalize_value(&record.course_name);
    let region = normalize_value(&record.region);
    let course_code = normalize_value(&record.course_code);
    let best_season = normalize_value(&record.best_season);
    let notes = normalize_value(&record.notes);

    let mut score = 0.0;

    for term in &terms {
        if course_name.contains(term) {
            score += 0.35;
        }
        if region.contains(term) {
            score += 0.25;
        }
        if course_code.contains(term) {
            score += 0.15;
        }
        if best_season.contains(term) {
            score += 0.15;
        }
        if notes.contains(term) {
            score += 0.1;
        }
        if term == "海景" && (notes.contains('海') || notes.contains("悬崖")) {
            score += 0.35;
        }
        if term == "度假" && (notes.contains("酒店") || notes.contains("度假")) {
            score += 0.35;
        }
        if term == "短途" && (region.contains("singapore") || notes.contains("机场")) {
            score += 0.35;
        }
    }

    score / terms.len() as f32
}

pub fn filter_and_sort(records: &[GuideRecord], query: &GuidesQuery) -> Vec<GuideRecord> {
    let mut guides = filter_region(records, query.region.as_deref());

    if let Some(search) = query.search.as_ref().filter(|search| !search.trim().is_empty()) {
        if matches!(query.search_mode.unwrap_or_default(), SearchMode::Keyword) {
            guides = keyword_filter(&guides, search);
        }
    }

    sort_guides(&mut guides, query.sort.unwrap_or_default());

    guides
}

pub fn filter_region(records: &[GuideRecord], region: Option<&str>) -> Vec<GuideRecord> {
    let mut guides = records.to_vec();

    if let Some(region) = region.filter(|region| !region.trim().is_empty()) {
        guides.retain(|record| record.region == region);
    }

    guides
}

pub fn keyword_filter(records: &[GuideRecord], search: &str) -> Vec<GuideRecord> {
    let normalized = normalize_value(search);

    records
        .iter()
        .filter(|record| {
            [
                &record.course_name,
                &record.region,
                &record.course_code,
                &record.best_season,
                &record.notes,
            ]
            .into_iter()
            .map(|value| normalize_value(value))
            .any(|value| value.contains(&normalized))
        })
        .cloned()
        .collect()
}

pub fn sort_guides(guides: &mut [GuideRecord], sort_mode: SortMode) {
    match sort_mode {
        SortMode::UpdatedDesc => guides.sort_by(|left, right| right.updated_at.cmp(&left.updated_at)),
        SortMode::UpdatedAsc => guides.sort_by(|left, right| left.updated_at.cmp(&right.updated_at)),
        SortMode::FeeDesc => guides.sort_by(|left, right| right.green_fee.cmp(&left.green_fee)),
        SortMode::FeeAsc => guides.sort_by(|left, right| left.green_fee.cmp(&right.green_fee)),
        SortMode::NameAsc => guides.sort_by(|left, right| left.course_name.cmp(&right.course_name)),
    }
}

pub fn sort_semantic_guides(guides: &mut [(GuideRecord, f32)], sort_mode: SortMode) {
    guides.sort_by(|(left_guide, left_score), (right_guide, right_score)| {
        right_score
            .total_cmp(left_score)
            .then_with(|| compare_guides(left_guide, right_guide, sort_mode))
    });
}

fn compare_guides(left: &GuideRecord, right: &GuideRecord, sort_mode: SortMode) -> std::cmp::Ordering {
    match sort_mode {
        SortMode::UpdatedDesc => right.updated_at.cmp(&left.updated_at),
        SortMode::UpdatedAsc => left.updated_at.cmp(&right.updated_at),
        SortMode::FeeDesc => right.green_fee.cmp(&left.green_fee),
        SortMode::FeeAsc => left.green_fee.cmp(&right.green_fee),
        SortMode::NameAsc => left.course_name.cmp(&right.course_name),
    }
}

pub fn duplicate_preview(records: &[GuideRecord], input: &GuideInput) -> Vec<DuplicatePreviewMatch> {
    let fingerprint = fingerprint_for_input(input);
    let mut entries = records
        .iter()
        .cloned()
        .map(|guide| {
            let exact = fingerprint_for_record(&guide) == fingerprint;
            let score = score_similarity_record_input(&guide, input);
            DuplicatePreviewMatch { guide, exact, score }
        })
        .filter(|entry| entry.exact || entry.score >= 0.45)
        .collect::<Vec<_>>();

    entries.sort_by(|left, right| {
        right
            .exact
            .cmp(&left.exact)
            .then_with(|| right.score.total_cmp(&left.score))
    });
    entries.truncate(5);
    entries
}

pub fn duplicate_groups(records: &[GuideRecord]) -> Vec<DuplicateGroup> {
    let mut groups: HashMap<String, Vec<GuideRecord>> = HashMap::new();

    for record in records.iter().cloned() {
        groups
            .entry(fingerprint_for_record(&record))
            .or_default()
            .push(record);
    }

    let mut duplicates = groups
        .into_iter()
        .filter_map(|(key, items)| (items.len() > 1).then_some(DuplicateGroup { key, items }))
        .collect::<Vec<_>>();

    duplicates.sort_by(|left, right| right.items.len().cmp(&left.items.len()));
    duplicates
}

pub fn build_import_audits(existing: &[GuideRecord], inserted: &[GuideRecord]) -> Vec<ImportAudit> {
    inserted
        .iter()
        .map(|record| {
            let fingerprint = fingerprint_for_record(record);
            let exact_matches = existing
                .iter()
                .filter(|existing_record| fingerprint_for_record(existing_record) == fingerprint)
                .count();
            let similar_matches = existing
                .iter()
                .filter(|existing_record| {
                    score_similarity_record_input(
                        existing_record,
                        &GuideInput {
                            course_name: record.course_name.clone(),
                            region: record.region.clone(),
                            course_code: record.course_code.clone(),
                            green_fee: record.green_fee,
                            best_season: record.best_season.clone(),
                            notes: record.notes.clone(),
                        },
                    ) >= 0.45
                })
                .count();

            ImportAudit {
                id: record.id.clone(),
                course_name: record.course_name.clone(),
                course_code: record.course_code.clone(),
                region: record.region.clone(),
                exact_matches,
                similar_matches,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use crate::models::{GuideInput, GuideRecord, GuidesQuery, SearchMode};

    use super::{duplicate_preview, filter_and_sort, semantic_score};

    fn sample_record() -> GuideRecord {
        GuideRecord {
            id: "1".to_string(),
            course_name: "Sentosa Serapong".to_string(),
            region: "Singapore".to_string(),
            course_code: "SG-SEN-SRP".to_string(),
            green_fee: 3100,
            best_season: "February to April".to_string(),
            notes: "适合城市高尔夫短途，机场交通方便。".to_string(),
            updated_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn semantic_search_matches_short_trip_hint() {
        assert!(semantic_score(&sample_record(), "短途 城市") > 0.22);
    }

    #[test]
    fn keyword_filter_returns_matching_record() {
        let guides = vec![sample_record()];
        let query = GuidesQuery {
            search: Some("singapore".to_string()),
            search_mode: Some(SearchMode::Keyword),
            ..GuidesQuery::default()
        };
        assert_eq!(filter_and_sort(&guides, &query).len(), 1);
    }

    #[test]
    fn duplicate_preview_detects_exact_match() {
        let guides = vec![sample_record()];
        let input = GuideInput {
            course_name: "Sentosa Serapong".to_string(),
            region: "Singapore".to_string(),
            course_code: "SG-SEN-SRP".to_string(),
            green_fee: 3100,
            best_season: "February to April".to_string(),
            notes: "适合城市高尔夫短途，机场交通方便。".to_string(),
        };
        assert!(duplicate_preview(&guides, &input)[0].exact);
    }
}
