# Source extraction and scope

The user authorized extracting these integrations from their Class_Helper project for collaboration on SameClass. Original files remain untouched. No local environment files, user credentials, private coursework, unrelated datasets, or source checkout dependencies were copied.

| Original source | SameClass destination / adaptation |
| --- | --- |
| `Class_Helper/class_search_api/api.py` | `class_search_api/api.py`: original ASU URL, request headers, class search and subject retrieval; added course details, public syllabus resolution and bounded aggregation |
| `Class_Helper/class_search_api/server.py` | `class_search_api/server.py`, `normalize.py`: retained `/api/search`, `/api/course_description`, `/api/syllabus_url`; extracted data transformations, replaced HTML instructor anchors with structured names and links |
| `Class_Helper/class_search_api/debug_course_api.py` | Promoted the tested course-detail request into `get_courses` and `/api/courses` |
| `Class_Helper/student_insights/agents/syllabus_agent.py` | `class_search_api/syllabus.py`: current/prior-term instructor-aware lookup, public download resolution and PDF/DOCX/HTML/text extraction; removed LangGraph, LLM synthesis, UI state, hard-coded term history and local project imports |
| `Class_Helper/rmp_api/rmp.py` | `rmp_api/rmp.py`: school search, professor search/pagination, school-wide retrieval and review retrieval; deduplicated GraphQL code, fixed top-level error handling and added profile/detail/bulk coverage APIs |
| `Class_Helper/rmp_api/ui_server.py` | `rmp_api/server.py`: retained the three API routes, added pagination/options and explicit HTTP errors, removed HTML/static hosting |
| Track 1's verified `asu-registration-buddy/scripts/catalog.py` | `class_search_api/schedule.py` and section-link generation: reuse the current ASU link parameter names, section fragment and meeting-row normalization |

Original debug/test scripts made live requests at import time and printed raw bodies. They are replaced by offline pytest coverage and the explicit `scripts/smoke_test.py` command. The APIs do not import `student_insights`, LangGraph, OpenRouter, Reddit, or Graphify.

Response changes are intentional: errors use real HTTP statuses instead of successful empty results; instructor names are structured JSON rather than HTML; missing facts are null/unknown; normalized responses use the documented SameClass contract. Full ASU source fields remain available via `/api/search/raw`, `include_raw=true`, and `/api/courses`. Original Python client names and list-returning RMP methods remain available for migration.

No frontend application is included. FastAPI's `/docs` and `/redoc` are generated API reference pages for developers.
