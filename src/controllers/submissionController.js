import Response from '../models/Response.js';
import GameState from '../models/GameState.js';
import Team from '../models/Team.js';

export const submitAnswer = async (req, res) => {
  try {
    const { questionId, answerData } = req.body;
    const team = req.team;

    if (!team) {
      return res.status(401).json({ message: 'Team authentication required' });
    }

    // 1. Authoritative check on game state
    const state = await GameState.findOne({ key: 'LIVE_GAME_STATE' });
    if (!state || state.questionStatus !== 'ACTIVE') {
      return res.status(400).json({ message: 'Submissions are currently locked or question is not active.' });
    }

    if (state.currentQuestionId.toString() !== questionId) {
      return res.status(400).json({ message: 'Submission does not match the currently active question.' });
    }

    // 2. Check server deadline
    const now = new Date();
    // Allow small network tolerance
    if (state.endTime && now.getTime() > new Date(state.endTime).getTime() + 1000) {
      return res.status(400).json({ message: 'Time limit expired. Submission closed.' });
    }

    // 3. Prevent duplicate submission
    const existing = await Response.findOne({ teamId: team._id, questionId });
    if (existing) {
      return res.status(400).json({ message: 'Your team has already submitted an answer for this question. Answers are locked.' });
    }

    // 4. Calculate elapsed time in seconds with millisecond precision
    const elapsedMs = Math.max(0, now.getTime() - new Date(state.startTime).getTime());
    const submissionTimeSeconds = parseFloat((elapsedMs / 1000).toFixed(2));

    await Response.create({
      teamId: team._id,
      questionId,
      round: state.currentRound,
      questionNumber: state.currentQuestionNumber,
      answerData,
      submittedAt: now,
      submissionTimeSeconds,
      isTimeout: false,
      isLocked: true
    });

    return res.status(201).json({
      success: true,
      message: 'Answer successfully submitted and locked!',
      submissionTimeSeconds,
      submittedAt: now
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Duplicate submission rejected: already submitted.' });
    }
    return res.status(500).json({ message: 'Error submitting answer', error: error.message });
  }
};

export const getQuestionSubmissions = async (req, res) => {
  try {
    const { questionId } = req.params;
    const submissions = await Response.find({ questionId })
      .populate('teamId', 'teamId teamName captainName')
      .sort({ submissionTimeSeconds: 1 });

    const totalApprovedTeams = await Team.countDocuments({ status: 'approved' });

    return res.status(200).json({
      success: true,
      count: submissions.length,
      totalApprovedTeams,
      submissions
    });
  } catch (error) {
    return res.status(500).json({ message: 'Error fetching submissions', error: error.message });
  }
};

export const getTeamSubmissionForCurrentQuestion = async (req, res) => {
  try {
    const team = req.team;
    const state = await GameState.findOne({ key: 'LIVE_GAME_STATE' });
    if (!state || !state.currentQuestionId) {
      return res.status(200).json({ submitted: false, response: null });
    }

    const response = await Response.findOne({
      teamId: team._id,
      questionId: state.currentQuestionId
    });

    return res.status(200).json({
      submitted: !!response,
      response
    });
  } catch (error) {
    return res.status(500).json({ message: 'Error checking submission status', error: error.message });
  }
};
