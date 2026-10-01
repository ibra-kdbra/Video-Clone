/**
 * The demo school: who's in it, its courses, and where each demo persona starts. The mock
 * backend (./server.js) turns this into the API's data, and generates the classmates' activity
 * from each course's `popularity` and `difficulty`.
 *
 * Video lessons embed real lectures from YouTube education channels, credited in each lesson's
 * notes; "The Physics of Sound" uses the school's own videos (./media.js). People and the school
 * are fictional.
 */

export const SCHOOL = {
  slug: 'grand-academy',
  name: 'Grand Academy',
  description:
    'An online school for curious people: mathematics, computing, science and history, taught through short video lessons, quizzes and hands-on assignments.',
};

export const DEMO_PASSWORD = 'demo';

const person = (key, name, role, extra = {}) => ({
  key,
  name,
  email: `${key}@grand-academy.demo`,
  role,
  ...extra,
});

export const PEOPLE = [
  person('amira', 'Amira Haddad', 'student', {
    persona: 'Student',
    blurb: 'Halfway through Linear Algebra, with an essay just graded and a quiz to retake.',
  }),
  person('daniel', 'Daniel Okafor', 'instructor', {
    persona: 'Instructor',
    blurb: 'Teaches maths and physics. Has work to grade, a lesson to publish, and insights to read.',
  }),
  person('lena', 'Lena Fischer', 'owner', {
    persona: 'School owner',
    blurb: "Runs Grand Academy: every course, every member, and the school's storage.",
  }),
  // The rest of the staff.
  person('sofia', 'Sofia Marquez', 'instructor'),
  person('omar', 'Omar Siddiqui', 'instructor'),
  person('marco', 'Marco Bianchi', 'admin'),
  // Classmates.
  ...[
    ['noah', 'Noah Becker'],
    ['priya', 'Priya Raman'],
    ['lucas', 'Lucas Moreau'],
    ['hana', 'Hana Sato'],
    ['mateo', 'Mateo Rossi'],
    ['zara', 'Zara Ahmed'],
    ['ethan', 'Ethan Brooks'],
    ['leila', 'Leila Karimi'],
    ['jonas', 'Jonas Weber'],
    ['chloe', 'Chloé Martin'],
    ['kwame', 'Kwame Mensah'],
    ['sara', 'Sara Lindqvist'],
    ['diego', 'Diego Herrera'],
    ['mei', 'Mei Lin'],
    ['tomas', 'Tomás Silva'],
    ['aisha', 'Aisha Bello'],
    ['felix', 'Felix Novak'],
    ['ines', 'Inês Duarte'],
    ['yusuf', 'Yusuf Demir'],
    ['grace', 'Grace Okonkwo'],
    ['arjun', 'Arjun Mehta'],
    ['elena', 'Elena Petrova'],
    ['samuel', 'Samuel Cohen'],
    ['nadia', 'Nadia Rahman'],
    ['oliver', 'Oliver Hughes'],
    ['lucia', 'Lucía Fernández'],
    ['haruto', 'Haruto Kimura'],
    ['fatima', 'Fatima Zahra Alaoui'],
    ['maya', 'Maya Goldberg'],
    ['ivan', 'Ivan Horvat'],
    ['amara', 'Amara Nwosu'],
    ['hugo', 'Hugo Lambert'],
    ['sienna', 'Sienna Clarke'],
    ['rafael', 'Rafael Costa'],
    ['nora', 'Nora Jensen'],
    ['kofi', 'Kofi Asante'],
    ['lina', 'Lina Barakat'],
    ['adam', 'Adam Kowalski'],
    ['julia', 'Julia Nowak'],
    ['ravi', 'Ravi Pillai'],
    ['emma', 'Emma Laurent'],
    ['bilal', 'Bilal Chaudhry'],
  ].map(([key, name]) => person(key, name, 'student')),
];

const yt = (ref, credit) => ({ provider: 'youtube', ref, credit });
const upload = (media) => ({ provider: 'upload', media });
const credit = (title, channel) => `\n\n---\n\n*Video: “${title}” by ${channel}, on YouTube.*`;

export const COURSES = [
  // Mathematics ----------------------------------------------------------------------------------
  {
    slug: 'linear-algebra-visually',
    title: 'Linear Algebra, Visually',
    summary: 'See vectors, matrices and determinants as pictures in motion, then put them to work.',
    description: `Linear algebra is the language behind computer graphics, machine learning and much of physics, yet it's usually taught as rules for shuffling numbers in grids. This course starts from pictures instead: every matrix is a way of moving space around, and every rule follows from that.

Each lesson pairs a short animated lecture with notes that pin down the key idea. A quiz checks that the pictures have stuck, and the project asks you to invent a transformation of your own.

**You'll learn to**
- read vectors as arrows and as lists of numbers, and move between the two
- see a matrix as where the basis vectors land
- compose transformations by multiplying matrices
- explain what the determinant measures, and when it's zero

*Lectures by 3Blue1Brown, from the series “Essence of linear algebra”.*`,
    author: 'daniel',
    status: 'published',
    publishedDaysAgo: 46,
    cover: { youtube: 'fNk_zzaMoSs' },
    popularity: 0.78,
    difficulty: 0.55,
    modules: [
      {
        title: 'Vectors and the spaces they make',
        lessons: [
          {
            key: 'vectors',
            kind: 'lesson',
            title: 'What a vector really is',
            summary: 'Arrows, lists of numbers, and why both views matter.',
            preview: true,
            video: yt('fNk_zzaMoSs', '3Blue1Brown'),
            notes: `## Key ideas
- A **vector** can be read three ways: an arrow in space (the physicist's view), an ordered list of numbers (the computer scientist's view), or anything you can add and scale (the mathematician's view).
- In linear algebra, arrows almost always start at the **origin**. The numbers are instructions: how far to walk along *x*, then along *y*.
- **Adding** vectors means walking one arrow, then the other, tip to tail. **Scaling** stretches, squishes or flips an arrow; the number doing it is a *scalar*.

## Try it
Sketch \`(2, 1) + (-1, 3)\` as two arrows, tip to tail. Where do you end up? Check it by adding the numbers.${credit('Vectors | Chapter 1, Essence of linear algebra', '3Blue1Brown')}`,
          },
          {
            key: 'span',
            kind: 'lesson',
            title: 'Linear combinations, span and basis',
            summary: 'Every vector you can reach by scaling and adding two others.',
            video: yt('k7RM-ot2NWY', '3Blue1Brown'),
            notes: `## Key ideas
- \`î\` and \`ĵ\`, the unit vectors along *x* and *y*, are the **basis** of the plane: every vector is some amount of each.
- A **linear combination** of two vectors scales each one and adds the results: \`a·v + b·w\`.
- The **span** of a set of vectors is everything you can reach with linear combinations of them. Two vectors usually span the whole plane, but if they line up, their span is just a line.
- Vectors are **linearly dependent** when one adds nothing new to the span; otherwise they're independent.

## Check yourself
Do \`(1, 2)\` and \`(2, 4)\` span the plane? What about \`(1, 2)\` and \`(2, 1)\`?${credit('Linear combinations, span, and basis vectors | Chapter 2', '3Blue1Brown')}`,
          },
        ],
      },
      {
        title: 'Matrices move space',
        lessons: [
          {
            key: 'transformations',
            kind: 'lesson',
            title: 'Linear transformations and matrices',
            summary: 'A matrix records where î and ĵ land. That is all it needs.',
            video: yt('kYB8IZa5AuE', '3Blue1Brown'),
            notes: `## Key ideas
- A **linear transformation** keeps grid lines parallel and evenly spaced, and keeps the origin where it is.
- Because of that, you only need to know where **î** and **ĵ** land. Every other vector follows, since it's a combination of those two.
- Write where î lands as the first column and where ĵ lands as the second: that's the **matrix**.
- Multiplying a matrix by a vector means: take that much of the first column, plus that much of the second.

## Example
A 90° turn counter-clockwise sends î to \`(0, 1)\` and ĵ to \`(-1, 0)\`, so its matrix has columns \`(0, 1)\` and \`(-1, 0)\`.${credit('Linear transformations and matrices | Chapter 3', '3Blue1Brown')}`,
          },
          {
            key: 'composition',
            kind: 'lesson',
            title: 'Matrix multiplication as composition',
            summary: 'Doing one transformation, then another, is a single new matrix.',
            video: yt('XkY2DOUCWMU', '3Blue1Brown'),
            notes: `## Key ideas
- Applying one transformation and then another gives a third: their **composition**.
- The product \`BA\` means *first A, then B*. Read it right to left, like functions: \`B(A(v))\`.
- Order matters. A rotation followed by a shear usually isn't the same as the shear followed by the rotation, so \`AB\` and \`BA\` generally differ.
- Multiplication *is* associative: \`(AB)C = A(BC)\`, because both mean "C, then B, then A".${credit('Matrix multiplication as composition | Chapter 4', '3Blue1Brown')}`,
          },
          {
            key: 'determinant',
            kind: 'lesson',
            title: 'The determinant',
            summary: 'How much a transformation stretches or squishes area.',
            video: yt('Ip3X9LOh2dk', '3Blue1Brown'),
            notes: `## Key ideas
- The **determinant** is the factor by which a transformation scales area. A determinant of 3 triples every area; ½ halves it.
- A **negative** determinant means space has been flipped over (orientation reversed).
- A determinant of **0** squishes the plane onto a line or a point: the columns are linearly dependent, and information is lost.
- For a 2×2 matrix with columns \`(a, c)\` and \`(b, d)\`: \`det = ad − bc\`.

## Try it
What's the determinant of the 90° rotation from the earlier lesson? Does a rotation change area?${credit('The determinant | Chapter 6', '3Blue1Brown')}`,
          },
          {
            key: 'la-check',
            kind: 'quiz',
            title: 'Check your understanding',
            summary: 'Five questions on vectors, matrices and determinants.',
            notes: 'Five questions on everything so far. You need **70%** to pass, and you have three attempts. The answers are shown once you pass or run out of attempts.',
            quiz: {
              passPercent: 70,
              maxAttempts: 3,
              questions: [
                {
                  key: 'q1',
                  kind: 'single',
                  prompt: 'A transformation sends î to (2, 0) and ĵ to (0, 3). Which matrix describes it?',
                  explanation: 'The columns of a matrix are where the basis vectors land: (2, 0) is the first column, (0, 3) the second.',
                  points: 1,
                  options: [
                    { label: 'Columns (2, 0) and (0, 3)', correct: true },
                    { label: 'Columns (0, 2) and (3, 0)', correct: false },
                    { label: 'Columns (2, 3) and (0, 0)', correct: false },
                    { label: 'Columns (3, 0) and (0, 2)', correct: false },
                  ],
                },
                {
                  key: 'q2',
                  kind: 'single',
                  prompt: 'What does the determinant of a 2×2 matrix tell you?',
                  explanation: 'The determinant is the factor by which the transformation scales area; its sign says whether orientation flips.',
                  points: 1,
                  options: [
                    { label: 'How much it scales areas', correct: true },
                    { label: 'The angle it rotates by', correct: false },
                    { label: 'The length of its first column', correct: false },
                    { label: 'How many vectors it has', correct: false },
                  ],
                },
                {
                  key: 'q3',
                  kind: 'multiple',
                  prompt: 'Which of these are true of every linear transformation?',
                  explanation: 'Linear transformations keep the origin fixed and keep lines straight, with grid lines parallel and evenly spaced. They can still stretch lengths.',
                  points: 2,
                  options: [
                    { label: 'The origin stays where it is', correct: true },
                    { label: 'Grid lines stay parallel and evenly spaced', correct: true },
                    { label: 'Every length stays the same', correct: false },
                    { label: 'Straight lines stay straight', correct: true },
                  ],
                },
                {
                  key: 'q4',
                  kind: 'single',
                  prompt: 'Which single matrix does the same as applying A first and then B?',
                  explanation: 'Products read right to left, like functions: first A, then B, is BA.',
                  points: 1,
                  options: [
                    { label: 'BA', correct: true },
                    { label: 'AB', correct: false },
                    { label: 'A + B', correct: false },
                    { label: 'B − A', correct: false },
                  ],
                },
                {
                  key: 'q5',
                  kind: 'short',
                  prompt: 'What is the determinant of the matrix with columns (3, 1) and (2, 4)?',
                  explanation: 'ad − bc = 3·4 − 2·1 = 10.',
                  points: 1,
                  answers: ['10', 'ten'],
                },
              ],
            },
          },
          {
            key: 'la-project',
            kind: 'assignment',
            title: 'Project: invent a transformation',
            summary: 'Design a 2×2 matrix, draw what it does, and explain it.',
            notes: `Make up a 2×2 matrix of your own (avoid the identity and plain rotations).

1. Say where **î** and **ĵ** land.
2. Draw the unit square before and after the transformation. A photo of a sketch on paper is fine.
3. Compute the **determinant**, and explain in three to five sentences what it tells you: does area grow or shrink, and is space flipped?

Write your answer below, and attach your drawing as an image or PDF.`,
            assignment: { maxPoints: 20, allowText: true, allowFiles: true, dueInDays: 6 },
          },
        ],
      },
    ],
  },
  {
    slug: 'calculus-first-steps',
    title: 'Calculus: First Steps',
    summary: 'Where calculus comes from, what a derivative means, and how it describes motion.',
    description: `Calculus can look like a wall of symbols. Underneath are two ideas, slicing things into tiny pieces and measuring how fast things change, and both are easier to see than to write down.

This short course builds those ideas from pictures, then uses them on the most familiar change of all: things moving.

**You'll learn to**
- find an area by adding up thin slices
- explain what a derivative measures, and why "instantaneous change" isn't a paradox
- connect position, velocity and acceleration

*Lectures by 3Blue1Brown (“Essence of calculus”) and CrashCourse (“Crash Course Physics”).*`,
    author: 'daniel',
    status: 'published',
    publishedDaysAgo: 21,
    cover: { youtube: 'WUvTyaaNkzM' },
    popularity: 0.48,
    difficulty: 0.62,
    modules: [
      {
        title: 'The big ideas',
        lessons: [
          {
            key: 'essence-of-calculus',
            kind: 'lesson',
            title: 'The essence of calculus',
            summary: 'The area of a circle, found by slicing it into rings.',
            preview: true,
            video: yt('WUvTyaaNkzM', '3Blue1Brown'),
            notes: `## Key ideas
- Slice a circle into thin concentric rings. Unrolled, each ring is nearly a thin rectangle with area \`2πr · dr\`.
- Line those rectangles up and they fill a triangle under the line \`2πr\`. Its area is \`½ · R · 2πR = πR²\`.
- The thinner the slices, the better the approximation. Calculus is the study of what happens in that limit.
- Two questions turn out to be inverses of each other: *what's the area under a curve?* (integrals) and *how steep is it here?* (derivatives).${credit('The essence of calculus', '3Blue1Brown')}`,
          },
          {
            key: 'derivative-paradox',
            kind: 'lesson',
            title: 'The paradox of the derivative',
            summary: 'How can something change "at an instant"?',
            video: yt('9vKqVkMQHKk', '3Blue1Brown'),
            notes: `## Key ideas
- Change needs two moments to compare, so "speed at an instant" sounds like a contradiction.
- The **derivative** resolves it: it's the value that \`Δdistance / Δtime\` approaches as the time step shrinks towards zero.
- Graphically, it's the **slope** of the tangent line at a point.
- For \`f(t) = t³\`, the derivative is \`3t²\`. The video shows why, by expanding \`(t + dt)³\`.${credit('The paradox of the derivative | Chapter 2, Essence of calculus', '3Blue1Brown')}`,
          },
        ],
      },
      {
        title: 'Calculus in motion',
        lessons: [
          {
            key: 'motion',
            kind: 'lesson',
            title: 'Motion in a straight line',
            summary: 'Position, velocity and acceleration, and how they fit together.',
            video: yt('ZM8ECpBuQYE', 'CrashCourse'),
            notes: `## Key ideas
- **Position** says where something is; **displacement** is the change in position.
- **Velocity** is how fast position changes: the derivative of position. **Acceleration** is how fast velocity changes.
- Under constant acceleration: \`v = v₀ + at\` and \`x = x₀ + v₀t + ½at²\`.
- Near Earth's surface, things in free fall accelerate downward at about **9.8 m/s²**.${credit('Motion in a Straight Line: Crash Course Physics #1', 'CrashCourse')}`,
          },
          {
            key: 'calc-check',
            kind: 'quiz',
            title: 'Quick check',
            summary: 'Four questions on slicing, slopes and motion.',
            notes: 'Four questions. **75%** to pass, unlimited attempts.',
            quiz: {
              passPercent: 75,
              maxAttempts: null,
              questions: [
                {
                  key: 'q1',
                  kind: 'single',
                  prompt: 'In the essence of calculus lesson, how is the area of a circle found?',
                  explanation: 'Thin rings, unrolled into near-rectangles, add up to a triangle with area πR².',
                  points: 1,
                  options: [
                    { label: 'By slicing it into thin rings and adding up their areas', correct: true },
                    { label: 'By squaring its circumference', correct: false },
                    { label: 'By measuring it with a grid of squares', correct: false },
                  ],
                },
                {
                  key: 'q2',
                  kind: 'single',
                  prompt: 'What does a derivative measure?',
                  explanation: 'A derivative is the rate of change at a point: the slope of the tangent line.',
                  points: 1,
                  options: [
                    { label: 'The rate of change at an instant', correct: true },
                    { label: 'The total area under a curve', correct: false },
                    { label: 'The average value of a function', correct: false },
                    { label: 'The highest point of a curve', correct: false },
                  ],
                },
                {
                  key: 'q3',
                  kind: 'short',
                  prompt: 'An object’s position is x(t) = t² metres. What is its velocity, in m/s, at t = 3 seconds?',
                  explanation: 'Velocity is the derivative of position: 2t, which is 6 m/s at t = 3.',
                  points: 1,
                  answers: ['6', '6 m/s', 'six'],
                },
                {
                  key: 'q4',
                  kind: 'single',
                  prompt: 'Velocity is the derivative of…',
                  explanation: 'Velocity is how fast position changes. Acceleration is the derivative of velocity.',
                  points: 1,
                  options: [
                    { label: 'position', correct: true },
                    { label: 'acceleration', correct: false },
                    { label: 'mass', correct: false },
                  ],
                },
              ],
            },
          },
          {
            key: 'falling-phone',
            kind: 'assignment',
            title: 'Problem: the falling phone',
            summary: 'Use the motion equations on a real-world drop.',
            notes: `A phone slips off a balcony 20 m above the ground. Ignore air resistance.

1. How long does it take to reach the ground?
2. How fast is it going when it lands?
3. Sketch its velocity over time. What does the slope of that graph mean?

Show your working.`,
            assignment: { maxPoints: 10, allowText: true, allowFiles: false, dueInDays: -2 },
          },
        ],
      },
    ],
  },

  // Computing ------------------------------------------------------------------------------------
  {
    slug: 'neural-networks',
    title: 'Neural Networks: The Big Ideas',
    summary: 'What a neural network is, how it learns, and what backpropagation really does.',
    description: `Neural networks recognise faces, translate languages and write text, but the core machinery fits in three lectures. This course follows a network that reads handwritten digits, from the neurons that hold pixel brightness to the calculus that tunes its thousands of weights.

No programming is needed; the ideas come first.

**You'll learn to**
- describe layers, weights, biases and activations
- explain what a cost function is and how gradient descent lowers it
- say what backpropagation computes, and why it works backwards

*Lectures by 3Blue1Brown, from the series “Neural networks”.*`,
    author: 'sofia',
    status: 'published',
    publishedDaysAgo: 30,
    cover: { youtube: 'aircAruvnKk' },
    popularity: 0.66,
    difficulty: 0.6,
    modules: [
      {
        title: 'How a network sees',
        lessons: [
          {
            key: 'what-is-a-network',
            kind: 'lesson',
            title: 'But what is a neural network?',
            summary: 'Layers of numbers, from pixels to a digit.',
            preview: true,
            video: yt('aircAruvnKk', '3Blue1Brown'),
            notes: `## Key ideas
- A **neuron** here is just a number between 0 and 1, its *activation*.
- The first layer holds the image: one neuron per pixel (784 for a 28×28 picture). The last layer has ten neurons, one per digit.
- Each neuron in the next layer takes a **weighted sum** of the previous layer, adds a **bias**, and squashes the result (with a sigmoid or ReLU).
- The hope is that middle layers pick up useful pieces (edges, loops, strokes), though real networks don't always oblige.
- The digit network has about **13,000** weights and biases: those are what learning adjusts.${credit('But what is a neural network? | Chapter 1, Deep learning', '3Blue1Brown')}`,
          },
        ],
      },
      {
        title: 'How it learns',
        lessons: [
          {
            key: 'gradient-descent',
            kind: 'lesson',
            title: 'Gradient descent',
            summary: 'Rolling downhill on the cost function.',
            video: yt('IHZwWFHWa-w', '3Blue1Brown'),
            notes: `## Key ideas
- A **cost function** scores how badly the network does: add up the squared differences between its output and the right answer, over many training examples.
- Learning means finding weights and biases that make the cost small.
- The **gradient** points in the direction the cost rises fastest. Stepping the other way, again and again, is **gradient descent**.
- It finds a *local* minimum, which is usually good enough.${credit('Gradient descent, how neural networks learn | Chapter 2', '3Blue1Brown')}`,
          },
          {
            key: 'backpropagation',
            kind: 'lesson',
            title: 'What backpropagation really does',
            summary: 'How each example nudges every weight.',
            video: yt('Ilg3gGewQ5U', '3Blue1Brown'),
            notes: `## Key ideas
- For one training example, decide how each output neuron *should* change, then how the previous layer should change to make that happen, and so on **backwards** through the network.
- Weights connected to brighter (more active) neurons have more influence, so they get bigger nudges.
- Averaging those nudges over many examples gives the negative gradient.
- In practice, the data is split into **mini-batches** to keep each step cheap (*stochastic* gradient descent).${credit('What is backpropagation really doing? | Chapter 3', '3Blue1Brown')}`,
          },
          {
            key: 'nn-check',
            kind: 'quiz',
            title: 'Neural networks quiz',
            summary: 'Five questions on neurons, cost and learning.',
            notes: '**70%** to pass, two attempts.',
            quiz: {
              passPercent: 70,
              maxAttempts: 2,
              questions: [
                {
                  key: 'q1',
                  kind: 'single',
                  prompt: 'In the digit-reading network, what does each neuron of the first layer hold?',
                  explanation: 'The input layer has one neuron per pixel, holding its brightness from 0 to 1.',
                  points: 1,
                  options: [
                    { label: 'The brightness of one pixel', correct: true },
                    { label: 'One whole digit', correct: false },
                    { label: 'One of the weights', correct: false },
                    { label: "The network's final answer", correct: false },
                  ],
                },
                {
                  key: 'q2',
                  kind: 'single',
                  prompt: 'What does gradient descent do?',
                  explanation: 'It repeatedly steps the weights and biases opposite the gradient, the direction that lowers the cost fastest.',
                  points: 1,
                  options: [
                    { label: 'Nudges the weights in the direction that lowers the cost fastest', correct: true },
                    { label: 'Adds layers until the network is accurate', correct: false },
                    { label: 'Tries random weights until one works', correct: false },
                  ],
                },
                {
                  key: 'q3',
                  kind: 'multiple',
                  prompt: 'Which of these does the network learn during training?',
                  explanation: 'Training adjusts the weights and biases. The image size and the labels are given.',
                  points: 2,
                  options: [
                    { label: 'Weights', correct: true },
                    { label: 'Biases', correct: true },
                    { label: 'The number of pixels in an image', correct: false },
                    { label: 'The labels of the training images', correct: false },
                  ],
                },
                {
                  key: 'q4',
                  kind: 'short',
                  prompt: 'Which algorithm works out how every weight should change, by going backwards through the network?',
                  explanation: 'Backpropagation computes the gradient layer by layer, from the output back to the input.',
                  points: 1,
                  answers: ['backpropagation', 'back propagation', 'backprop'],
                },
                {
                  key: 'q5',
                  kind: 'single',
                  prompt: 'What does the cost function measure?',
                  explanation: 'The cost is how far the outputs are from the right answers, averaged over the training data.',
                  points: 1,
                  options: [
                    { label: 'How badly the network does on the training examples', correct: true },
                    { label: 'How long training takes', correct: false },
                    { label: 'How much memory the network needs', correct: false },
                  ],
                },
              ],
            },
          },
          {
            key: 'nn-explain',
            kind: 'assignment',
            title: 'Explain it to a friend',
            summary: 'Describe how a network learns, without equations.',
            notes: `In 200 to 300 words, explain to a friend who has never heard of neural networks how a network learns to read handwritten digits. Use one everyday analogy, and mention the cost function and gradient descent without any formulas.`,
            assignment: { maxPoints: 10, allowText: true, allowFiles: false, dueInDays: 9 },
          },
        ],
      },
    ],
  },
  {
    slug: 'how-computers-work',
    title: 'How Computers Work',
    summary: 'From the abacus to the transistor, and the logic gates every computer is built on.',
    description: `Every computer, from a phone to a data centre, is built from switches that are either on or off. This course traces how people got there, from counting machines to vacuum tubes to transistors, and then shows how a handful of logic gates can make decisions.

**You'll learn to**
- outline the history of computing machines
- explain why transistors replaced relays and vacuum tubes
- read and write truth tables for AND, OR and NOT

*Lectures by CrashCourse, from “Crash Course Computer Science”.*`,
    author: 'sofia',
    status: 'published',
    publishedDaysAgo: 58,
    cover: { youtube: 'O5nskjZ_GoI' },
    popularity: 0.57,
    difficulty: 0.35,
    modules: [
      {
        title: 'From gears to transistors',
        lessons: [
          {
            key: 'early-computing',
            kind: 'lesson',
            title: 'Early computing',
            summary: 'The abacus, mechanical calculators and punch cards.',
            preview: true,
            video: yt('O5nskjZ_GoI', 'CrashCourse'),
            notes: `## Key ideas
- People have built tools to help them calculate for thousands of years, starting with the **abacus**.
- Before machines, a "computer" was a job title: a person who did calculations.
- Mechanical calculators such as **Leibniz's Step Reckoner** could add, subtract, multiply and divide.
- **Punch cards**, first used to control looms, were later used to tabulate the 1890 US census, and the company behind it grew into IBM.${credit('Early Computing: Crash Course Computer Science #1', 'CrashCourse')}`,
          },
          {
            key: 'electronic-computing',
            kind: 'lesson',
            title: 'Electronic computing',
            summary: 'Relays, vacuum tubes, and finally transistors.',
            video: yt('LN0ucKNX0hc', 'CrashCourse'),
            notes: `## Key ideas
- **Relays** are electrically controlled mechanical switches. They worked, but slowly, and they wore out.
- **Vacuum tubes** switched with no moving parts and were far faster, but they were fragile, hot and power-hungry.
- The **transistor** (1947) is a solid-state switch: small, fast, cheap and reliable. Modern chips hold billions of them.${credit('Electronic Computing: Crash Course Computer Science #2', 'CrashCourse')}`,
          },
          {
            key: 'logic-gates',
            kind: 'lesson',
            title: 'Boolean logic and logic gates',
            summary: 'True and false, AND, OR, NOT and XOR.',
            video: yt('gI-qXk7XojA', 'CrashCourse'),
            notes: `## Key ideas
- **Boolean logic** works with two values, true and false, which map neatly onto on and off.
- **NOT** flips its input. **AND** is true only when both inputs are. **OR** is true when at least one is. **XOR** is true when exactly one is.
- Each gate can be built from a few transistors, and every computation a computer does is built from gates like these.

| A | B | A AND B | A OR B | A XOR B |
|---|---|---|---|---|
| 0 | 0 | 0 | 0 | 0 |
| 0 | 1 | 0 | 1 | 1 |
| 1 | 0 | 0 | 1 | 1 |
| 1 | 1 | 1 | 1 | 0 |${credit('Boolean Logic & Logic Gates: Crash Course Computer Science #3', 'CrashCourse')}`,
          },
          {
            key: 'cw-check',
            kind: 'quiz',
            title: 'Quiz: switches and gates',
            summary: 'Five quick questions.',
            notes: '**60%** to pass, three attempts.',
            quiz: {
              passPercent: 60,
              maxAttempts: 3,
              questions: [
                {
                  key: 'q1',
                  kind: 'single',
                  prompt: 'Which invention replaced vacuum tubes and made modern computers possible?',
                  explanation: 'The transistor: a small, solid-state switch with no moving parts.',
                  points: 1,
                  options: [
                    { label: 'The transistor', correct: true },
                    { label: 'The relay', correct: false },
                    { label: 'The punch card', correct: false },
                  ],
                },
                {
                  key: 'q2',
                  kind: 'single',
                  prompt: 'An AND gate outputs true when…',
                  explanation: 'AND needs both of its inputs to be true.',
                  points: 1,
                  options: [
                    { label: 'both inputs are true', correct: true },
                    { label: 'at least one input is true', correct: false },
                    { label: 'exactly one input is true', correct: false },
                    { label: 'both inputs are false', correct: false },
                  ],
                },
                {
                  key: 'q3',
                  kind: 'multiple',
                  prompt: 'Which of these were used for calculating before electronic computers?',
                  explanation: 'The abacus, mechanical calculators and electromechanical relays all came before electronic machines. Microprocessors came much later.',
                  points: 2,
                  options: [
                    { label: 'The abacus', correct: true },
                    { label: 'Mechanical calculators', correct: true },
                    { label: 'Electromechanical relays', correct: true },
                    { label: 'Microprocessors', correct: false },
                  ],
                },
                {
                  key: 'q4',
                  kind: 'short',
                  prompt: 'How many different values can a single bit hold?',
                  explanation: 'A bit is either 0 or 1: two values.',
                  points: 1,
                  answers: ['2', 'two'],
                },
                {
                  key: 'q5',
                  kind: 'single',
                  prompt: 'What is (NOT true) AND true?',
                  explanation: 'NOT true is false, and false AND anything is false.',
                  points: 1,
                  options: [
                    { label: 'false', correct: true },
                    { label: 'true', correct: false },
                  ],
                },
              ],
            },
          },
          {
            key: 'truth-table',
            kind: 'assignment',
            title: 'Build a truth table',
            summary: 'Work out a small circuit by hand.',
            notes: `Write out the full truth table for **(A AND B) OR (NOT C)**, with all eight combinations of A, B and C.

Then answer: for how many of the eight is the output true? Type your table below or attach a photo of it.`,
            assignment: { maxPoints: 10, allowText: true, allowFiles: true, dueInDays: 4 },
          },
        ],
      },
    ],
  },
  {
    slug: 'code-your-first-website',
    title: 'Code Your First Website',
    summary: 'HTML from the very first tag to a page of your own, published for friends to see.',
    description: `Every website starts as a plain text file of HTML. In this course you'll write one: headings, paragraphs, links, images, lists and forms, then a page about something you love.

The main lecture is long, so the notes break it into chapters. Pause, type along, and come back to the quiz when you're done.

**You'll learn to**
- set up a free code editor and preview pages in your browser
- structure a page with the right tags
- add links and images, with alt text for people who can't see them

*Lecture by freeCodeCamp.*`,
    author: 'sofia',
    status: 'published',
    publishedDaysAgo: 12,
    cover: { youtube: 'pQN-pnXPaVg' },
    popularity: 0.42,
    difficulty: 0.7,
    modules: [
      {
        title: 'Getting started',
        lessons: [
          {
            key: 'setup',
            kind: 'lesson',
            title: 'Set up your editor',
            summary: 'A free editor, a folder and your first file.',
            preview: true,
            video: null,
            notes: `Before the lecture, get your tools ready. It takes five minutes.

1. Install a free code editor. **Visual Studio Code** works on Windows, macOS and Linux.
2. Make a folder called \`my-site\` and open it in the editor.
3. Create a file called \`index.html\` and type:

\`\`\`html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>My first page</title>
  </head>
  <body>
    <h1>Hello!</h1>
    <p>This is my first web page.</p>
  </body>
</html>
\`\`\`

4. Save it, then open the file in your browser (double-click it). You've made a web page.

When it works, press **Mark as complete** and move on to the lecture.`,
          },
          {
            key: 'html-course',
            kind: 'lesson',
            title: 'The HTML lecture',
            summary: 'Tags, attributes, links, images, lists, tables and forms.',
            video: yt('pQN-pnXPaVg', 'freeCodeCamp.org'),
            notes: `This is a long lecture: take it in chunks, and type every example yourself.

## What it covers
- the structure of a document: \`<!doctype>\`, \`<html>\`, \`<head>\` and \`<body>\`
- headings \`<h1>\` to \`<h6>\`, paragraphs and line breaks
- links with \`<a href="…">\`, and images with \`<img src="…" alt="…">\`
- lists, tables and forms

## Tip
Keep your \`index.html\` from the last lesson open, and add to it as you go. By the end you'll have most of your project done.${credit('HTML Full Course - Build a Website Tutorial', 'freeCodeCamp.org')}`,
          },
          {
            key: 'html-check',
            kind: 'quiz',
            title: 'HTML quiz',
            summary: 'Four questions on tags and attributes.',
            notes: '**75%** to pass, unlimited attempts.',
            quiz: {
              passPercent: 75,
              maxAttempts: null,
              questions: [
                {
                  key: 'q1',
                  kind: 'single',
                  prompt: 'Which tag makes the most important heading on a page?',
                  explanation: '<h1> is the top-level heading; <h6> the lowest. <head> holds information about the page, not visible content.',
                  points: 1,
                  options: [
                    { label: '<h1>', correct: true },
                    { label: '<h6>', correct: false },
                    { label: '<head>', correct: false },
                    { label: '<header>', correct: false },
                  ],
                },
                {
                  key: 'q2',
                  kind: 'single',
                  prompt: 'Which attribute gives a link its destination?',
                  explanation: 'href ("hypertext reference") holds the address a link goes to.',
                  points: 1,
                  options: [
                    { label: 'href', correct: true },
                    { label: 'src', correct: false },
                    { label: 'alt', correct: false },
                  ],
                },
                {
                  key: 'q3',
                  kind: 'short',
                  prompt: 'Which tag puts an image on the page? Type its name without the angle brackets.',
                  explanation: 'The <img> tag, with src for the file and alt for a text description.',
                  points: 1,
                  answers: ['img'],
                },
                {
                  key: 'q4',
                  kind: 'multiple',
                  prompt: 'Which of these belong inside <head> rather than <body>?',
                  explanation: 'The title and the character set describe the page; paragraphs and images are its visible content.',
                  points: 2,
                  options: [
                    { label: '<title>', correct: true },
                    { label: '<meta charset="utf-8">', correct: true },
                    { label: '<p>', correct: false },
                    { label: '<img>', correct: false },
                  ],
                },
              ],
            },
          },
          {
            key: 'my-page',
            kind: 'assignment',
            title: 'Project: a page about something you love',
            summary: 'A one-page site with headings, a list, a link and an image.',
            notes: `Make a one-page site about a hobby, a place or a person you admire. It should have:

- a main heading and at least two sections with their own headings
- a list
- a link to another website
- an image, with good alt text

Hand in a ZIP of your \`my-site\` folder, or screenshots of the page, and write two sentences about what you'd add next.`,
            assignment: { maxPoints: 25, allowText: true, allowFiles: true, dueInDays: 14 },
          },
        ],
      },
    ],
  },

  // Science --------------------------------------------------------------------------------------
  {
    slug: 'physics-of-sound',
    title: 'The Physics of Sound',
    summary: 'Hear and see what pitch, loudness, beats and timbre really are.',
    description: `Sound is air being pushed and pulled, hundreds of times a second. In four short lessons you'll see those waves drawn as you hear them, and learn the two numbers that describe any pure tone, why two nearly-matching notes throb, and what makes a violin sound different from a flute playing the same note.

These lessons are Grand Academy's own videos, so the player keeps track of what you've watched: you'll pick up where you left off, and each lesson completes once you've seen most of it.

**You'll learn to**
- relate frequency to pitch and amplitude to loudness
- predict how fast two tones will beat
- explain timbre in terms of harmonics`,
    author: 'daniel',
    status: 'published',
    publishedDaysAgo: 18,
    cover: { media: 'sound-waves' },
    popularity: 0.72,
    difficulty: 0.3,
    modules: [
      {
        title: 'Waves you can hear',
        lessons: [
          {
            key: 'what-is-sound',
            kind: 'lesson',
            title: 'What a sound wave looks like',
            summary: 'Frequency and pitch: 220, 440 and 880 Hz.',
            preview: true,
            video: upload('sound-waves'),
            notes: `## Key ideas
- A sound is a **pressure wave**: the air is squeezed and stretched as the wave passes.
- **Frequency** is how many waves pass each second, measured in **hertz (Hz)**. We hear it as **pitch**.
- Doubling the frequency raises a note by one **octave**: 220 Hz, 440 Hz and 880 Hz are all the note A.
- People hear roughly 20 Hz to 20,000 Hz, with the top end dropping as we get older.

## Listen for it
Each tone in the video is an A, an octave apart. Notice how the waves get shorter as the pitch rises.`,
          },
          {
            key: 'loudness',
            kind: 'lesson',
            title: 'Loudness and amplitude',
            summary: 'Same note, smaller waves: what changes when sound gets quieter.',
            video: upload('loudness'),
            notes: `## Key ideas
- **Amplitude** is how far the pressure swings from normal: the height of the wave.
- Bigger amplitude, louder sound. The pitch doesn't change, because the frequency doesn't.
- Loudness is usually measured in **decibels (dB)**, a logarithmic scale: every 10 dB is ten times the sound energy, which we hear as roughly twice as loud.`,
          },
        ],
      },
      {
        title: 'When sounds combine',
        lessons: [
          {
            key: 'beats',
            kind: 'lesson',
            title: 'Beats: two notes that almost match',
            summary: 'Why 440 Hz and 444 Hz together throb four times a second.',
            video: upload('beats'),
            notes: `## Key ideas
- When two waves meet, they **add up**. In step, they reinforce each other; out of step, they cancel.
- Two tones with slightly different frequencies drift in and out of step, so the combined sound swells and fades: these are **beats**.
- The beat rate is the **difference** of the frequencies: 444 Hz − 440 Hz = 4 beats per second.
- Musicians tune by ear this way: as two notes get closer, the beats slow down, and they vanish when the notes match.`,
          },
          {
            key: 'timbre',
            kind: 'lesson',
            title: 'Timbre: same note, different shapes',
            summary: 'Harmonics, and why instruments sound different.',
            video: upload('timbre'),
            notes: `## Key ideas
- Real instruments don't play one frequency. They play a **fundamental** plus **harmonics** at 2, 3, 4… times its frequency.
- The fundamental sets the **pitch**. The mix of harmonics sets the **timbre**, the "colour" of the sound.
- Odd harmonics only (3×, 5×, 7×…) sound hollow, a bit like a clarinet. All harmonics, falling off gently, sound bright and buzzy, like a bowed string.
- Adding the harmonics together gives the wave's shape: the more harmonics, the further it gets from a smooth sine.`,
          },
          {
            key: 'resonance',
            kind: 'lesson',
            title: 'Resonance and standing waves',
            summary: 'Why a guitar string sings at some notes and not others.',
            status: 'draft',
            video: null,
            notes: `## Key ideas
- Every object has **natural frequencies** at which it vibrates most easily. Pushing it at one of them, in time with its own swing, builds up large vibrations: **resonance**.
- A string fixed at both ends can only hold waves that fit a whole number of half-wavelengths. These **standing waves** are its fundamental and its harmonics.
- That's why a plucked string sounds a clear note, and why the body of a guitar or violin, resonating with it, makes the note louder and colours its timbre.

## Try it
Hum steadily into a cardboard tube or a bottle and slide your pitch up and down. At some notes the tube suddenly booms: you've found one of its natural frequencies.`,
          },
          {
            key: 'sound-check',
            kind: 'quiz',
            title: 'Sound quiz',
            summary: 'Five questions on pitch, loudness, beats and timbre.',
            notes: '**70%** to pass, as many attempts as you like.',
            quiz: {
              passPercent: 70,
              maxAttempts: null,
              questions: [
                {
                  key: 'q1',
                  kind: 'single',
                  prompt: 'A tone of 440 Hz is followed by one of 880 Hz. How does the second compare?',
                  explanation: 'Twice the frequency is the same note one octave higher. Loudness depends on amplitude, not frequency.',
                  points: 1,
                  options: [
                    { label: 'It is one octave higher', correct: true },
                    { label: 'It is twice as loud', correct: false },
                    { label: 'It is one octave lower', correct: false },
                    { label: 'It is a different note entirely', correct: false },
                  ],
                },
                {
                  key: 'q2',
                  kind: 'single',
                  prompt: "What does a wave's amplitude control?",
                  explanation: 'Amplitude is the size of the pressure swings: how loud the sound is.',
                  points: 1,
                  options: [
                    { label: 'How loud it is', correct: true },
                    { label: 'How high it sounds', correct: false },
                    { label: 'How fast it travels', correct: false },
                  ],
                },
                {
                  key: 'q3',
                  kind: 'short',
                  prompt: 'Tones of 300 Hz and 305 Hz are played together. How many beats per second do you hear?',
                  explanation: 'The beat rate is the difference of the frequencies: 305 − 300 = 5.',
                  points: 1,
                  answers: ['5', 'five'],
                },
                {
                  key: 'q4',
                  kind: 'multiple',
                  prompt: 'Which of these change the timbre of a note without changing its pitch?',
                  explanation: 'Timbre comes from the harmonics and their strengths. Doubling the frequency changes the pitch; turning it down only changes loudness.',
                  points: 2,
                  options: [
                    { label: 'Adding harmonics', correct: true },
                    { label: 'Changing how strong each harmonic is', correct: true },
                    { label: 'Doubling the frequency', correct: false },
                    { label: 'Turning the volume down', correct: false },
                  ],
                },
                {
                  key: 'q5',
                  kind: 'single',
                  prompt: 'Tuning two strings, a guitarist hears the beats slow down. What is happening?',
                  explanation: 'The beat rate equals the difference in frequency, so slower beats mean the notes are getting closer.',
                  points: 1,
                  options: [
                    { label: 'The two notes are getting closer in frequency', correct: true },
                    { label: 'The two notes are getting further apart', correct: false },
                    { label: 'The strings are getting louder', correct: false },
                  ],
                },
              ],
            },
          },
          {
            key: 'beat-lab',
            kind: 'assignment',
            title: 'Lab: hear the beats yourself',
            summary: 'Make beats with two tones and measure them.',
            notes: `Use any free online tone generator that can play two tones at once (or two phones side by side).

1. Play 440 Hz and 442 Hz together. Count the beats in ten seconds.
2. Try 440 Hz with 446 Hz. Count again.
3. Do your counts match the rule *beats per second = difference in frequency*? If not, why might they differ?

Write up your results. A short recording or a photo of your notes is welcome.`,
            assignment: { maxPoints: 15, allowText: true, allowFiles: true, dueInDays: 8 },
          },
        ],
      },
    ],
  },
  {
    slug: 'big-ideas',
    title: 'Big Ideas: Four Introductions',
    summary: 'The universe, the atom, the mind and the economy, in four short lectures.',
    description: `A sampler for the curious: four of the biggest subjects there are, each introduced in about ten minutes by people who love them. Watch them in any order, then tell us which one you'd like to study next.

**In this course**
- astronomy: our place in the universe
- chemistry: what's inside an atom's nucleus
- psychology: how we study the mind
- economics: choices, scarcity and trade

*Lectures by CrashCourse.*`,
    author: 'lena',
    status: 'published',
    publishedDaysAgo: 64,
    cover: { youtube: '0rHUDWjR5gg' },
    popularity: 0.5,
    difficulty: 0.4,
    modules: [
      {
        title: 'Four big subjects',
        lessons: [
          {
            key: 'astronomy',
            kind: 'lesson',
            title: 'Introduction to astronomy',
            summary: 'What astronomy studies, and how we learn about places we can never visit.',
            preview: true,
            video: yt('0rHUDWjR5gg', 'CrashCourse'),
            notes: `## Key ideas
- Astronomy studies everything beyond Earth's atmosphere: planets, stars, galaxies and the universe itself.
- Almost everything we know about space comes from **light**, which we collect with eyes and telescopes.
- The night sky is something anyone can start observing, no equipment needed.${credit('Introduction to Astronomy: Crash Course Astronomy #1', 'CrashCourse')}`,
          },
          {
            key: 'nucleus',
            kind: 'lesson',
            title: 'The nucleus',
            summary: 'Protons, neutrons and what holds them together.',
            video: yt('FSyAehMdpyI', 'CrashCourse'),
            notes: `## Key ideas
- An atom's **nucleus** holds its protons and neutrons; electrons are found around it.
- The number of **protons** decides which element it is. Atoms of the same element with different numbers of neutrons are **isotopes**.
- The **strong nuclear force** holds the nucleus together, despite the protons repelling each other.${credit('The Nucleus: Crash Course Chemistry #1', 'CrashCourse')}`,
          },
          {
            key: 'psychology',
            kind: 'lesson',
            title: 'Introduction to psychology',
            summary: 'The science of behaviour and mental processes.',
            video: yt('vo4pMVb0R6M', 'CrashCourse'),
            notes: `## Key ideas
- Psychology is the **scientific study of behaviour and mental processes**.
- It grew out of philosophy and biology, and early schools of thought disagreed sharply about what the mind is and how to study it.
- Today it ranges from brain chemistry to how groups behave.${credit('Intro to Psychology: Crash Course Psychology #1', 'CrashCourse')}`,
          },
          {
            key: 'economics',
            kind: 'lesson',
            title: 'Introduction to economics',
            summary: 'Scarcity, choices and trade-offs.',
            video: yt('3ez10ADR_gM', 'CrashCourse'),
            notes: `## Key ideas
- Economics studies how people, businesses and governments make choices about **scarce resources**.
- Every choice has an **opportunity cost**: the next best thing you give up.
- **Microeconomics** looks at individual people and firms; **macroeconomics** at whole economies.${credit('Intro to Economics: Crash Course Econ #1', 'CrashCourse')}`,
          },
          {
            key: 'big-ideas-check',
            kind: 'quiz',
            title: 'Four-subject quiz',
            summary: 'One question from each lecture.',
            notes: '**50%** to pass. Unlimited attempts.',
            quiz: {
              passPercent: 50,
              maxAttempts: null,
              questions: [
                {
                  key: 'q1',
                  kind: 'single',
                  prompt: "What holds protons and neutrons together in an atom's nucleus?",
                  explanation: 'The strong nuclear force, which at these tiny distances overpowers the repulsion between protons.',
                  points: 1,
                  options: [
                    { label: 'The strong nuclear force', correct: true },
                    { label: 'Gravity', correct: false },
                    { label: 'Magnetism', correct: false },
                  ],
                },
                {
                  key: 'q2',
                  kind: 'single',
                  prompt: 'Economics is mainly the study of how people…',
                  explanation: 'Economics studies choices about scarce resources.',
                  points: 1,
                  options: [
                    { label: 'make choices about scarce resources', correct: true },
                    { label: 'predict the weather', correct: false },
                    { label: 'classify plants and animals', correct: false },
                  ],
                },
                {
                  key: 'q3',
                  kind: 'single',
                  prompt: 'Psychology is the scientific study of…',
                  explanation: 'Behaviour and mental processes.',
                  points: 1,
                  options: [
                    { label: 'behaviour and mental processes', correct: true },
                    { label: 'rocks and minerals', correct: false },
                    { label: 'ancient languages', correct: false },
                  ],
                },
                {
                  key: 'q4',
                  kind: 'short',
                  prompt: 'What do we call the next-best option you give up when you make a choice? (Two words.)',
                  explanation: 'That is the opportunity cost of the choice.',
                  points: 1,
                  answers: ['opportunity cost'],
                },
              ],
            },
          },
          {
            key: 'next-subject',
            kind: 'assignment',
            title: 'Which subject next?',
            summary: 'Tell us which big idea you want to study, and why.',
            notes: 'In a paragraph or two: which of the four subjects would you most like to study further, and what question about it do you most want answered?',
            assignment: { maxPoints: 10, allowText: true, allowFiles: false, dueInDays: null },
          },
        ],
      },
    ],
  },

  // History --------------------------------------------------------------------------------------
  {
    slug: 'first-civilizations',
    title: 'The First Civilizations',
    summary: 'How farming led to cities, writing and empires along the great rivers.',
    description: `Around twelve thousand years ago, people began to farm. Within a few thousand years there were cities, kings, temples, taxes and writing, first along a handful of great rivers.

This course visits three of those river valleys, the Indus, the Tigris and Euphrates, and the Nile, and asks why civilization appeared where it did.

**You'll learn to**
- explain how farming changed human societies
- compare the Indus Valley, Mesopotamia and Egypt
- build an argument from evidence in a short essay

*Lectures by CrashCourse, from “Crash Course World History”.*`,
    author: 'omar',
    status: 'published',
    publishedDaysAgo: 35,
    cover: { youtube: 'Yocja_N5s1I' },
    popularity: 0.6,
    difficulty: 0.45,
    modules: [
      {
        title: 'Farming changes everything',
        lessons: [
          {
            key: 'agricultural-revolution',
            kind: 'lesson',
            title: 'The agricultural revolution',
            summary: 'Why people settled down, and what it cost them.',
            preview: true,
            video: yt('Yocja_N5s1I', 'CrashCourse'),
            notes: `## Key ideas
- For most of human history, people lived by **foraging**: hunting and gathering.
- Farming began independently in several places, from about 10,000 BCE.
- Farming fed more people per acre and produced **surpluses**, which allowed settled villages, specialised jobs and, eventually, cities.
- It had costs too: harder work, less varied diets, and new diseases from living close together and close to animals.${credit('The Agricultural Revolution: Crash Course World History #1', 'CrashCourse')}`,
          },
        ],
      },
      {
        title: 'River valley civilizations',
        lessons: [
          {
            key: 'indus-valley',
            kind: 'lesson',
            title: 'The Indus Valley',
            summary: 'Planned cities, standard bricks, and a script we still cannot read.',
            video: yt('n7ndRwqJYDM', 'CrashCourse'),
            notes: `## Key ideas
- The Indus Valley (Harappan) civilization flourished in what is now Pakistan and northwest India, roughly 2600–1900 BCE.
- Cities such as **Harappa** and **Mohenjo-daro** had grid-like streets, drainage systems and standardised bricks.
- Their script hasn't been deciphered, so much about their society remains a puzzle.${credit('Indus Valley Civilization: Crash Course World History #2', 'CrashCourse')}`,
          },
          {
            key: 'mesopotamia',
            kind: 'lesson',
            title: 'Mesopotamia',
            summary: 'Cities, writing and laws between two rivers.',
            video: yt('sohXPx_XZ6Y', 'CrashCourse'),
            notes: `## Key ideas
- *Mesopotamia* means "between the rivers": the **Tigris** and the **Euphrates**, in modern Iraq.
- The Sumerians built some of the first cities, and developed **cuneiform**, one of the earliest writing systems.
- Writing began largely as record-keeping, of grain, taxes and trade.
- Later rulers such as **Hammurabi** of Babylon set down written law codes.${credit('Mesopotamia: Crash Course World History #3', 'CrashCourse')}`,
          },
          {
            key: 'ancient-egypt',
            kind: 'lesson',
            title: 'Ancient Egypt',
            summary: 'The Nile, the pharaohs and three thousand years of stability.',
            video: yt('Z3Wvw6BivVI', 'CrashCourse'),
            notes: `## Key ideas
- Egyptian civilization grew along the **Nile**, whose yearly floods left rich soil for farming.
- **Pharaohs** ruled as god-kings, and religion shaped art, architecture and burial.
- Egypt was remarkably stable for thousands of years, protected by deserts on either side.${credit('Ancient Egypt: Crash Course World History #4', 'CrashCourse')}`,
          },
          {
            key: 'civilizations-check',
            kind: 'quiz',
            title: 'River valleys quiz',
            summary: 'Five questions across the three civilizations.',
            notes: '**60%** to pass, three attempts.',
            quiz: {
              passPercent: 60,
              maxAttempts: 3,
              questions: [
                {
                  key: 'q1',
                  kind: 'single',
                  prompt: 'Why did farming lead to the first cities?',
                  explanation: 'Food surpluses let people settle in one place and take on specialised work.',
                  points: 1,
                  options: [
                    { label: 'Surpluses let people settle and specialise', correct: true },
                    { label: 'Farmers needed walls to keep animals in', correct: false },
                    { label: 'Hunting was banned by early kings', correct: false },
                  ],
                },
                {
                  key: 'q2',
                  kind: 'single',
                  prompt: 'Harappa and Mohenjo-daro were cities of which civilization?',
                  explanation: 'They are the best-known cities of the Indus Valley civilization.',
                  points: 1,
                  options: [
                    { label: 'The Indus Valley', correct: true },
                    { label: 'Ancient Egypt', correct: false },
                    { label: 'Mesopotamia', correct: false },
                  ],
                },
                {
                  key: 'q3',
                  kind: 'multiple',
                  prompt: 'Which rivers watered Mesopotamia?',
                  explanation: 'Mesopotamia lay between the Tigris and the Euphrates.',
                  points: 2,
                  options: [
                    { label: 'The Tigris', correct: true },
                    { label: 'The Euphrates', correct: true },
                    { label: 'The Nile', correct: false },
                    { label: 'The Indus', correct: false },
                  ],
                },
                {
                  key: 'q4',
                  kind: 'short',
                  prompt: 'Along which river did ancient Egyptian civilization grow?',
                  explanation: 'The Nile, whose floods made the land fertile.',
                  points: 1,
                  answers: ['Nile', 'the Nile', 'River Nile', 'the River Nile', 'the Nile River'],
                },
                {
                  key: 'q5',
                  kind: 'single',
                  prompt: 'What was the writing system of the Sumerians called?',
                  explanation: 'Cuneiform: wedge-shaped marks pressed into clay.',
                  points: 1,
                  options: [
                    { label: 'Cuneiform', correct: true },
                    { label: 'Hieroglyphs', correct: false },
                    { label: 'The Latin alphabet', correct: false },
                  ],
                },
              ],
            },
          },
          {
            key: 'river-valleys-essay',
            kind: 'assignment',
            title: 'Essay: why rivers?',
            summary: 'Argue why the first civilizations grew along rivers.',
            notes: `In 300 to 500 words, answer: **why did the first civilizations appear along great rivers?**

Use at least two of the three civilizations in this course as evidence, and consider one thing rivers made *harder*, not just easier.`,
            assignment: { maxPoints: 20, allowText: true, allowFiles: false, dueInDays: 5 },
          },
        ],
      },
    ],
  },

  // A draft, for the instructor persona to find in the editor -----------------------------------
  {
    slug: 'python-for-beginners',
    title: 'Python for Absolute Beginners',
    summary: 'Variables, loops and functions, with a small project at the end.',
    description: `A gentle start in programming with Python, one of the easiest languages to read and one of the most useful to know.

*Lecture by freeCodeCamp.*`,
    author: 'daniel',
    status: 'draft',
    publishedDaysAgo: null,
    cover: { youtube: 'rfscVS0vtbw' },
    popularity: 0,
    difficulty: 0.5,
    modules: [
      {
        title: 'Getting started',
        lessons: [
          {
            key: 'python-course',
            kind: 'lesson',
            title: 'The Python lecture',
            summary: 'Install Python, then work through the basics.',
            video: yt('rfscVS0vtbw', 'freeCodeCamp.org'),
            notes: `## Draft
Chapters to point out: installing Python, variables and data types, strings, lists, functions, if statements, loops.${credit('Learn Python - Full Course for Beginners', 'freeCodeCamp.org')}`,
          },
          {
            key: 'python-quiz',
            kind: 'quiz',
            title: 'Python basics quiz',
            summary: 'Still being written.',
            status: 'draft',
            notes: 'Questions coming soon.',
            quiz: { passPercent: 70, maxAttempts: null, questions: [] },
          },
        ],
      },
    ],
  },
];

/**
 * Where each persona starts. `completed` lists lessons already done; quizzes in `quizzes` get
 * past attempts with those percentages (a passing one completes the quiz); `watching` leaves an
 * uploaded video part-watched, to resume.
 */
export const START = {
  amira: [
    {
      course: 'linear-algebra-visually',
      enrolledDaysAgo: 14,
      completed: ['vectors', 'span'],
      lastLesson: 'transformations',
      quizzes: { 'la-check': [67] },
    },
    {
      course: 'physics-of-sound',
      enrolledDaysAgo: 6,
      completed: ['what-is-sound'],
      watching: { lesson: 'loudness', seconds: 14 },
    },
    {
      course: 'first-civilizations',
      enrolledDaysAgo: 20,
      completed: ['agricultural-revolution', 'indus-valley', 'mesopotamia', 'ancient-egypt'],
      quizzes: { 'civilizations-check': [100] },
      submissions: {
        'river-valleys-essay': {
          status: 'graded',
          grade: 17,
          daysAgo: 1,
          text: `Rivers gave the first farmers three things they could not get anywhere else: water through the dry season, soil renewed every year by floods, and an easy road for trade. In Egypt, the Nile's yearly flood left a strip of black soil so rich that farmers could feed far more people than themselves, and that surplus paid for priests, scribes and pyramid builders. In Mesopotamia, the Tigris and Euphrates were less predictable, so communities had to organise to dig canals and store grain, and record-keeping in cuneiform grew out of that organisation.

But rivers also made life harder. Mesopotamian floods could be violent and sudden, and irrigation slowly made the soil salty. Living close together along the banks spread disease. Still, the benefits were large enough that, again and again, the first cities appeared where a great river met fertile land.`,
          feedback: 'A clear, well-organised argument, and good use of both Egypt and Mesopotamia. To reach full marks, bring in the Indus Valley as well, and say a little more about how salinisation affected Mesopotamian farming over time.',
        },
      },
    },
    {
      course: 'how-computers-work',
      enrolledDaysAgo: 30,
      completed: ['early-computing', 'electronic-computing', 'logic-gates'],
      quizzes: { 'cw-check': [83] },
      submissions: {
        'truth-table': {
          status: 'submitted',
          daysAgo: 2,
          text: 'A B C | out\n0 0 0 | 1\n0 0 1 | 0\n0 1 0 | 1\n0 1 1 | 0\n1 0 0 | 1\n1 0 1 | 0\n1 1 0 | 1\n1 1 1 | 1\n\nThe output is true in 5 of the 8 rows: whenever C is false, plus the row where A and B are both true.',
        },
      },
    },
  ],
  daniel: [],
  lena: [],
};

/** What instructors write on the classmates' graded work. */
export const FEEDBACK = [
  'Clear and well reasoned. Your diagram made the idea easy to follow.',
  'Good work. Show one more step of your working next time, so I can see how you got there.',
  'A strong answer with a well-chosen example. Watch the units in your final line.',
  'You have the right idea, but the explanation stops short. What happens in the edge case?',
  'Excellent: concise, accurate and nicely presented.',
  'Solid effort. Revisit the second part; the reasoning there needs another look.',
  'Very good. Your analogy really helps, and the structure is easy to follow.',
  'Nearly there. Check your calculation in step 2, then the rest follows.',
  'Thoughtful and original. I enjoyed reading this.',
  'Correct throughout. Next time, add a sentence on why the method works, not just how.',
  'Good start. The argument would be stronger with a specific piece of evidence from the lectures.',
  'Neatly done, with every part of the question answered.',
];

/** What classmates write when they hand in work, for the instructor's grading queue. */
export const ANSWERS = [
  'I worked through this step by step and checked my answer a second way. My working is attached.',
  'Here is my answer. The trickiest part was the second question, so I explained my reasoning in more detail there.',
  'I followed the lecture method and then tried a variation of my own to see what changed.',
  'My answer is below. I was not sure about the last part, so I have explained what I tried.',
  'Done! I compared my result with a friend and we got the same answer by different routes.',
  'I started by drawing it out, which made the rest much easier. Notes and sketch attached.',
];
