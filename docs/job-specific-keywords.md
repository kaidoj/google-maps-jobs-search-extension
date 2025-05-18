# Job-Specific Keywords Feature

## Overview
The job-specific keywords feature allows users to define high-priority keywords that receive higher scoring (40 points vs 20 for regular keywords) during job page scanning. This helps prioritize search results that contain these specifically sought-after job characteristics.

## Implementation Details

### UI Components
- Added a new input field in the popup UI for job-specific keywords
- Styled job-specific keywords with a distinct color and highlighting in the results
- Added a new column for job-specific keywords in the CSV export

### Data Flow
1. User enters job-specific keywords in the input field (comma-separated)
2. Keywords are stored in local storage and included in search data
3. When scanning websites:
   - Regular keywords award 20 points when found
   - Job-specific keywords award 40 points when found
4. Search results show job-specific keywords with special highlighting

### Technical Implementation
- Both main pages and career pages are scanned for job-specific keywords
- Keywords are passed through the entire search flow from popup to background script
- Results are aggregated and displayed with specialized styling for job-specific keywords

## Best Practices for Users

### What are Job-Specific Keywords?
Job-specific keywords are terms that are particularly important in your job search. These might include:

- Work arrangements: "remote", "hybrid", "flexible hours"
- Seniority level: "senior", "lead", "junior", "entry-level"
- Employment type: "full-time", "part-time", "contract", "permanent"
- Special requirements: "immediate start", "urgent hiring", "no experience required"

### How to Use Job-Specific Keywords Effectively
1. **Be specific:** Use precise terms that are likely to appear in job postings
2. **Use fewer keywords:** Focus on 2-3 truly important terms
3. **Combine with regular keywords:** Use regular keywords for job titles/roles and job-specific keywords for important job characteristics
4. **Look for the highlighting:** Job-specific keyword matches appear with special highlighting in results

### Examples

**Good job-specific keywords:**
- remote, senior, immediate start
- junior, entry-level, intern
- contract, temporary, short-term
- flexible, part-time

**Less effective job-specific keywords:**
- developer (too general - use as a regular keyword instead)
- programming (too general - use as a regular keyword instead)

## Technical Notes

### Scoring System
- Regular keywords: 20 points per match
- Job-specific keywords: 40 points per match
- Common job terms: 5 points per match
- Job site link: 25 points per link
- Contact information: 5-10 points

### Future Enhancements
- Fuzzy matching for keywords to catch variations
- Weighting keywords based on proximity to job titles
- Adjustable scoring weights for different keyword categories
