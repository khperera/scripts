/* ---------- Calculation Functions ---------- */
function calculateE1RM(weight, reps, rpe) {
  // RIR-adjusted reps: at RPE 8 you have ~2 reps left, at RPE 10 you have 0
  var repadjust = Math.min(Math.max(0, 10 - rpe), 10);
  var actualreps = repadjust + reps;
  if(actualreps == 1){
    return weight
  }

  if (actualreps <= 16) {
    var epley = weight * (1 + 0.0333 * actualreps);
    var wathan = 100 * weight / (48.8+(53.8*Math.exp(-0.075*actualreps)))
    var lombardi = weight * (Math.pow(actualreps,0.1));
    return epley*0.33+wathan*0.33+lombardi*0.34;
  }

  return weight * Math.pow(actualreps, 0.1);
}

function roundToPlates(target, unit, minJump) {
  const jump = minJump || (unit === 'lb' ? 2.5 : 1.25);
  const plateWeight = jump * 2; // Both sides of barbell
  return Math.round(target / plateWeight) * plateWeight;
}

function prescribeLoad(trainingMax, reps, rpe, unit, minJump) {
  let percentage = 0
  RIR = 10 - rpe
  if(RIR<0)
    RIR = 0
  totalpossiblereps = reps + RIR

  if(totalpossiblereps<=16)
  {
    var epley = (1 + 0.0333 * totalpossiblereps);
    var wathan = 100 / (48.8 + (53.8 * Math.exp(-0.075 * totalpossiblereps)))
    var lombardi = (Math.pow(totalpossiblereps,0.1));
    var average = epley*0.33+wathan*0.33+lombardi*0.34;
    // Estimate percentage of 1RM by taking the inverse of the average of Epley, Wathan, and Lombardi formulas
    percentage = 1/average


  }


  else {
    percentage = 1/Math.pow(totalpossiblereps, 0.1)
  }
  if(totalpossiblereps == 1){
    percentage = 1
  }
  // const percentage = RPE_TABLE[reps]?.[rpe];
  // if (!percentage) return 0;

  const prescribedWeight = trainingMax * percentage;
  return roundToPlates(prescribedWeight, unit, minJump);

}


function getNextSetAdjustment(targetRpe, actualRpe, repsCompleted, targetReps) {
  if (!repsCompleted || repsCompleted < targetReps || actualRpe >= targetRpe + 1.0) {
    return 0.95; // Reduce weight
  }
  if (actualRpe <= targetRpe - 1.0) {
    return 1.025; // Increase weight
  }
  return 1.0; // Maintain weight
}

function getBestRollingE1RM(exerciseId, days = 42) {
  const cutoffDate = Date.now() - days * 86400000;
  let bestE1RM = 0;

  for (const set of state.log) {
    if (set.exId === exerciseId && new Date(set.date).getTime() >= cutoffDate) {
      bestE1RM = Math.max(bestE1RM, set.e1rm);
    }
  }

  return bestE1RM;
}

function progressTrainingMax(exercise) {
  const cutoffDate = Date.now() - 7 * 86400000;
  let score = 0;
  let bestWeeklyE1RM = 0;

  // Calculate weekly performance score
  for (const set of state.log) {
    if (set.exId !== exercise.id) continue;
    if (new Date(set.date).getTime() < cutoffDate) continue;

    // Use target RPE if available, otherwise fall back to simple RPE scoring
    const targetRPE = set.targetRpe || 8.5;
    const rpeDelta = set.rpe - targetRPE;

    let rpeScore = 0;
    if (rpeDelta >= 1.0) {
      rpeScore = -1; // Much harder than target
    } else if (rpeDelta >= 0.5) {
      rpeScore = 0.5; // Slightly harder than target
    } else if (rpeDelta <= -1.0) {
      rpeScore = 1; // Much easier than target
    } else {
      rpeScore = 1; // Hit target
    }

    score += rpeScore;
    bestWeeklyE1RM = Math.max(bestWeeklyE1RM, set.e1rm);
  }

  // Get progression rates based on body part
  const settings = state.settings;
  const isLower = isLowerBody(exercise.cat);
  const strongUp = isLower ? settings.upLowerStrong : settings.upUpperStrong;
  const smallUp = isLower ? settings.upLowerSmall : settings.upUpperSmall;
  const down = isLower ? settings.downLower : settings.downUpper;

  // Calculate new TM based on score
  let newTM = exercise.tm;
  if (score >= 2) {
    newTM = exercise.tm * (1 + strongUp / 100);
  } else if (score >= 0.5) {
    newTM = exercise.tm * (1 + smallUp / 100);
  } else if (score <= -1) {
    newTM = exercise.tm * (1 - down / 100);
  }

  // TM is set to the best reference e1RM (rolling 42-day best, this week's best, or current TM)
  const bestRollingE1RM = getBestRollingE1RM(exercise.id);
  const referenceMax = Math.max(bestRollingE1RM, bestWeeklyE1RM, exercise.tm);
  if (bestWeeklyE1RM > 0) {
    exercise.tm = referenceMax;
  }
  // else: no data logged this week, leave TM unchanged
}
