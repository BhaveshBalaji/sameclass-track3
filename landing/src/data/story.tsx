import type { ReactNode } from "react";
export type Person = "Maya" | "Arjun" | "Nina" | "Leo" | "Ray";
export type ChatLine = { person: Person; body: ReactNode; command?: string };
export type Chapter = {
  id: string;
  label: string;
  eyebrow: string;
  title: ReactNode;
  description: string;
  aside: string;
  lines: ChatLine[];
};
export function Mention({ children }: { children: ReactNode }) {
  return <span className="mention">@{children}</span>;
}
export function SourceLink({
  kind,
  children,
}: {
  kind: "catalog" | "reviews" | "syllabus";
  children: ReactNode;
}) {
  return (
    <button className="source-link" data-source={kind}>
      {children} ↗
    </button>
  );
}
export const chapters: Chapter[] = [
  {
    id: "preferences",
    label: "The group",
    eyebrow: "FOUR PEOPLE. FOUR DIFFERENT PLANS.",
    title: (
      <>
        Your friends.
        <br />
        <span>All their preferences.</span>
      </>
    ),
    description:
      "The semester starts in your group chat. Everyone brings their interests, their schedules, and their very specific dealbreakers.",
    aside: "Same conversation. Everyone gets heard.",
    lines: [
      {
        person: "Maya",
        body: (
          <>
            spring semester planning? 3 classes each. let’s take them together
            this time
          </>
        ),
      },
      {
        person: "Arjun",
        body: (
          <>
            yes! i’m really into databases. also, Mondays and Wednesdays 9–12
            are a hard no for me.
          </>
        ),
      },
      {
        person: "Maya",
        body: (
          <>
            AI and machine learning for me. something i can actually build with
            🤖
          </>
        ),
      },
      {
        person: "Nina",
        body: (
          <>software engineering here. morning classes if possible, please!</>
        ),
      },
      {
        person: "Leo",
        body: (
          <>
            AI / ML too. i prefer afternoons. i work Tue + Thu mornings, so
            nothing before noon those days.
          </>
        ),
      },
      {
        person: "Nina",
        body: <>four people with four schedules. this should be fun 😅</>,
      },
      { person: "Maya", body: <>that’s why Ray’s here ☀️</> },
    ],
  },
  {
    id: "discover",
    label: "Find courses",
    eyebrow: "A QUESTION, RIGHT IN THE CONVERSATION.",
    title: (
      <>
        Less searching.
        <br />
        <span>More possibilities.</span>
      </>
    ),
    description:
      "A database question comes up. Arjun uses /ask. Ray looks through the course catalog and brings useful options back into the chat.",
    aside: "The catalog comes to the conversation.",
    lines: [
      {
        person: "Arjun",
        body: <>before we pick—what database courses are even offered?</>,
      },
      {
        person: "Nina",
        body: <>something that helps with backend engineering would be nice</>,
      },
      {
        person: "Arjun",
        command: "/ask",
        body: (
          <>
            <Mention>Ray</Mention> what database courses should we look at for
            Spring 2027?
          </>
        ),
      },
      {
        person: "Ray",
        body: (
          <>
            <p>
              <Mention>Arjun</Mention> Here are three database courses to
              explore:
            </p>
            <p>
              <b>CSE 510 — Database Management System Implementation</b>
              <br />
              Build an understanding of database internals and query processing.
            </p>
            <p>
              <b>CSE 511 — Data Processing at Scale</b>
              <br />
              Explore large-scale data processing and distributed data tools.
            </p>
            <p>
              <b>CSE 512 — Distributed Database Systems</b>
              <br />
              Go deeper into data distributed across multiple systems.
            </p>
            <p>
              Let’s check the available sections against everyone’s schedules.
            </p>
            <SourceLink kind="catalog">ASU course catalog</SourceLink>
          </>
        ),
      },
      { person: "Arjun", body: <>510 sounds exactly like what i wanted</> },
      {
        person: "Nina",
        body: <>database internals could be really useful for me too</>,
      },
    ],
  },
  {
    id: "professors",
    label: "The professor",
    eyebrow: "A COURSE IS ONLY PART OF THE PICTURE.",
    title: (
      <>
        Meet the course.
        <br />
        <span>Then the professor.</span>
      </>
    ),
    description:
      "Before committing, the group asks about the person teaching it. Ray finds professor reviews and separates student opinions from course facts.",
    aside: "Real questions. More informed choices.",
    lines: [
      {
        person: "Maya",
        body: <>510 is on the shortlist. what’s the professor like though?</>,
      },
      {
        person: "Arjun",
        command: "/ask",
        body: (
          <>
            <Mention>Ray</Mention> look up the reviews for Professor Rivera.
            What do students say about their teaching?
          </>
        ),
      },
      {
        person: "Ray",
        body: (
          <>
            <p>
              <Mention>Arjun</Mention> I found the matching instructor profile.
              Here’s what the reviews in this example describe:
            </p>
            <p>
              <b>Teaching:</b> clear explanations, especially when walking
              through database concepts.
            </p>
            <p>
              <b>Coursework:</b> students describe hands-on assignments that
              reward starting early.
            </p>
            <p>
              <b>Keep in mind:</b> some reviewers found the project demanding.
              “Interesting” doesn’t necessarily mean “easy.”
            </p>
            <p>
              These are student experiences, not guarantees about your semester.
            </p>
            <SourceLink kind="reviews">
              Professor reviews · example excerpts
            </SourceLink>
          </>
        ),
      },
      {
        person: "Nina",
        body: <>i’m okay with a project if we’re learning something useful</>,
      },
      { person: "Leo", body: <>same. let’s check the actual syllabus next</> },
    ],
  },
  {
    id: "syllabus",
    label: "The syllabus",
    eyebrow: "THE ANSWER IS IN THE SYLLABUS.",
    title: (
      <>
        Know what
        <br />
        <span>you’re signing up for.</span>
      </>
    ),
    description:
      "Topics. Assessments. The grading scheme. Ray reads the syllabus and answers the question the group is actually asking—with a source to open.",
    aside: "From a syllabus question to a clear answer.",
    lines: [
      {
        person: "Maya",
        body: <>also curious about CSE 573. what do we actually learn?</>,
      },
      {
        person: "Maya",
        command: "/ask",
        body: (
          <>
            <Mention>Ray</Mention> what is CSE 573 about, and what’s the grading
            like? Is there a group project?
          </>
        ),
      },
      {
        person: "Ray",
        body: (
          <>
            <p>
              <b>CSE 573 is Semantic Web Mining.</b> You explore how text and
              web data can become useful, structured information.
            </p>
            <p>
              In this example syllabus, there’s <b>one midterm</b> and a{" "}
              <b>group project</b>.
            </p>
            <p>
              <b>Grading</b>
              <br />
              Group project — 40%
              <br />
              Midterm — 30%
              <br />
              Assignments — 20%
              <br />
              Participation — 10%
            </p>
            <p>
              <Mention>Maya</Mention> This example’s project explores{" "}
              <b>agentic AI</b>—an opportunity to build something you can
              discuss in job applications.
            </p>
            <SourceLink kind="syllabus">CSE 573 syllabus.pdf · p. 1</SourceLink>
          </>
        ),
      },
      {
        person: "Arjun",
        body: <>one midterm and a group project? okay, that helps</>,
      },
      {
        person: "Nina",
        body: (
          <>
            let’s keep 573 as an option. can Ray put our actual schedules
            together now?
          </>
        ),
      },
    ],
  },
  {
    id: "recommend",
    label: "The plan",
    eyebrow: "THE MOST COMMON GROUND. THE RIGHT EXCEPTIONS.",
    title: (
      <>
        One group.
        <br />
        <span>A plan for each person.</span>
      </>
    ),
    description:
      "One /plan recommend turns the conversation into individual profiles. Ray looks for the most shared classes, while respecting the constraints that make someone’s plan different.",
    aside: "Three share all three. The fourth shares two.",
    lines: [
      {
        person: "Maya",
        command: "/plan recommend",
        body: (
          <>
            <Mention>Ray</Mention> recommend three courses each, based on
            everything we’ve shared. Keep us together where you can!
          </>
        ),
      },
      {
        person: "Ray",
        body: (
          <>
            <p>
              I’ve built a profile for each of you from our planning
              conversation:
            </p>
            <p>
              <Mention>Maya</Mention> AI / ML + practical projects.
              <br />
              <Mention>Arjun</Mention> Databases; no Mon/Wed 9 AM–noon.
              <br />
              <Mention>Nina</Mention> Software engineering; mornings preferred.
              <br />
              <Mention>Leo</Mention> AI / ML; afternoons; no Tue/Thu mornings.
            </p>
          </>
        ),
      },
      {
        person: "Ray",
        body: (
          <>
            <p>
              <Mention>Maya</Mention> <Mention>Arjun</Mention>{" "}
              <Mention>Nina</Mention>
              <br />
              <b>CSE 510</b> · Tue/Thu 10:30–11:45 AM
              <br />
              <b>CSE 572</b> · Mon/Wed 1:30–2:45 PM
              <br />
              <b>CSE 573</b> · Mon/Wed 3:00–4:15 PM
            </p>
          </>
        ),
      },
      {
        person: "Ray",
        body: (
          <>
            <p>
              <Mention>Leo</Mention>
              <br />
              <b>CSE 572</b> · Mon/Wed 1:30–2:45 PM
              <br />
              <b>CSE 573</b> · Mon/Wed 3:00–4:15 PM
              <br />
              <b>CSE 564</b> · Tue/Thu 1:30–2:45 PM
            </p>
          </>
        ),
      },
      {
        person: "Ray",
        body: (
          <>
            <p>
              <b>Why this fits:</b> 572 + 573 bring everyone together around AI
              / ML. 510 gives Arjun the database depth he wanted and Nina useful
              systems experience.
            </p>
            <p>
              Leo’s work hours rule out 510’s morning section, so 564 is his
              afternoon alternative. Arjun’s Mon/Wed 9–12 block stays free.
            </p>
            <p>
              <Mention>Nina</Mention> You get one morning class; the two
              afternoon classes are the tradeoff for staying with the group.
            </p>
            <p>
              <b>Overall:</b> three of you share all three classes. All four
              share two. Confirm the real sections and prerequisites before
              choosing.
            </p>
          </>
        ),
      },
      {
        person: "Leo",
        body: (
          <>two classes with everyone and no work conflicts? works for me 🙌</>
        ),
      },
      {
        person: "Arjun",
        body: <>i get databases AND we still have classes together. sold</>,
      },
      {
        person: "Nina",
        body: (
          <>
            i can trade two mornings for this. let’s check the sections together
          </>
        ),
      },
    ],
  },
  {
    id: "voice",
    label: "Out loud",
    eyebrow: "SAME GROUP. SAME RAY. A DIFFERENT CHANNEL.",
    title: (
      <>
        Talk it through.
        <br />
        <span>Ray’s in the room.</span>
      </>
    ),
    description:
      "Move the conversation to a Discord voice channel. Discuss among yourselves, say “Ray,” and ask a question or request recommendations without switching back to text.",
    aside: "Unmute the mic to hear the group. You stay in control.",
    lines: [],
  },
];
export { voiceCues as voiceLines } from "./voice";
export const sourceContent = {
  catalog: {
    title: "Course catalog",
    label: "ILLUSTRATIVE COURSE DISCOVERY",
    body: "This scripted conversation uses ASU course names to demonstrate course discovery. Offering availability must be checked in the live ASU catalog.",
    lines: [
      "CSE 510 — Database Management System Implementation",
      "CSE 511 — Data Processing at Scale",
      "CSE 512 — Distributed Database Systems",
    ],
    url: "https://catalog.apps.asu.edu/catalog/courses/courselist?subject=CSE",
    link: "Open the ASU course catalog",
  },
  reviews: {
    title: "Professor reviews",
    label: "ILLUSTRATIVE REVIEW EXCERPTS",
    body: "Professor Rivera is a fictional instructor in this presentation. These demonstration themes are not reviews of a real person.",
    lines: [
      "Clear explanations and worked examples.",
      "Hands-on assignments; start the work early.",
      "A demanding project: interest and workload are separate considerations.",
    ],
    url: null,
    link: null,
  },
  syllabus: {
    title: "CSE 573 syllabus.pdf",
    label: "ILLUSTRATIVE SYLLABUS · PAGE 1",
    body: "A fictional syllabus excerpt for this presentation. The grading percentages and agentic AI project are example data, not verified requirements for a current ASU offering.",
    lines: [
      "Course: CSE 573 — Semantic Web Mining",
      "Topics: text and web data, information extraction, data linkage.",
      "Assessments: one midterm; one group project.",
      "Project 40% · Midterm 30% · Assignments 20% · Participation 10%.",
      "Example project: build an agentic AI application.",
    ],
    url: null,
    link: null,
  },
};
