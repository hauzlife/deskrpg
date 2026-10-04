/** Local presentation only. Never emit these lines to sockets, chat, or AI history. */
import { normalizeLocale, type ServerLocale } from "@/lib/i18n/server";

export type SmalltalkLocale = ServerLocale;

/** Exchanges per viewer locale. Every locale has the same number of pairs, and each line names the partner once. */
export const SMALLTALK_LINES: Record<SmalltalkLocale, readonly (readonly [string, string])[]> = {
  ko: [
    ["{name}님, 좋은 하루예요!", "{name}님도 좋은 하루 보내세요!"],
    ["{name}님, 잠깐 스트레칭 어때요?", "좋아요, {name}님! 어깨 좀 풀어야겠어요."],
    ["{name}님, 커피 한 잔 하셨어요?", "아직요! {name}님 덕분에 생각났네요."],
    ["{name}님, 오늘도 반가워요!", "저도요, {name}님. 오늘도 힘내요!"],
    ["{name}님, 점심 맛있게 드셨어요?", "네! {name}님도 식사 잘 챙기세요."],
    ["{name}님, 잠깐 바람 쐬러 가세요?", "네, {name}님. 잠깐 걸으니 좋네요."],
    ["{name}님, 오늘 컨디션 어떠세요?", "좋아요! {name}님은 어떠세요?"],
    ["{name}님, 오늘도 수고 많으세요.", "고마워요, {name}님. 같이 힘내요!"],
    ["{name}님, 칸반 태스크 진행은 잘 되고 있나요?", "단위 테스트 마무리 중이에요, {name}님! 곧 리뷰 요청할게요."],
    ["{name}님, 최신 PR 아키텍처 확인하셨나요?", "네, {name}님! 테스트 커버리지까지 완벽하게 통과했습니다."],
    ["{name}님, CI/CD 테스트 파이프라인 모두 통과했나요?", "종료 코드 0으로 100% 그린이에요, {name}님! 배포 준비 완료입니다."],
    ["{name}님, 스프린트 우선순위 카드 싱크할까요?", "좋은 생각이에요, {name}님! 백로그 블로커 함께 해결해봐요."],
    ["{name}님, 리팩토링이나 디버깅 도움 필요하세요?", "감사해요 {name}님! 이 동시성 쿼리 로직 같이 봐주실 수 있나요?"],
    ["{name}님, PM이 마일스톤 목표 업데이트했네요.", "확인했어요, {name}님! 핵심 프로덕션 배포에 집중하고 있습니다."],
    ["{name}님, 방금 카드 구현과 검증 완료했습니다.", "수고하셨어요 {name}님! 레디 컬럼에서 다음 카드 가져올게요."],
    ["{name}님, 그라파나 에러율이 0으로 떨어졌네요.", "좋은 소식이네요, {name}님! 안정화 패치가 안정적으로 작동 중입니다."],
  ],
  en: [
    ["{name}, have a good day!", "You too, {name}!"],
    ["{name}, how about a quick stretch?", "Good idea, {name}! My shoulders need it."],
    ["{name}, had your coffee yet?", "Not yet! Thanks for the reminder, {name}."],
    ["{name}, good to see you again!", "You too, {name}. Let's do our best today!"],
    ["{name}, did you enjoy lunch?", "I did! Don't skip your meals either, {name}."],
    ["{name}, stepping out for some air?", "Yes, {name}. A short walk feels nice."],
    ["{name}, how are you feeling today?", "Great! How about you, {name}?"],
    ["{name}, thanks for all your hard work.", "Thank you, {name}. Let's keep at it together!"],
    ["{name}, how is your sprint task progressing?", "Finishing unit tests now, {name}! Ready for review soon."],
    ["{name}, did you inspect the latest pull request?", "Yes, {name}! Architecture and test coverage look solid."],
    ["{name}, are all CI/CD integration tests green?", "100% green with exit code 0, {name}. Ready to deploy!"],
    ["{name}, let's sync on the priority kanban cards.", "Good idea, {name}! Let's unblock the backlog together."],
    ["{name}, need any help with that refactoring?", "Thanks {name}! Mind checking this concurrency logic with me?"],
    ["{name}, PM just updated the milestone goals.", "Saw that, {name}! Focusing on critical monetization deliverables."],
    ["{name}, just completed and verified that card.", "Awesome work, {name}! Picking up the next one from ready."],
    ["{name}, error rates on Grafana dropped to zero.", "Great news, {name}! Our reliability fixes are holding strong."],
  ],
  ja: [
    ["{name}さん、良い一日を！", "{name}さんも良い一日を！"],
    ["{name}さん、ちょっとストレッチしませんか？", "いいですね、{name}さん！肩をほぐさないと。"],
    ["{name}さん、コーヒーはもう飲みましたか？", "まだです！{name}さんのおかげで思い出しました。"],
    ["{name}さん、今日もよろしくお願いします！", "こちらこそ、{name}さん。今日も頑張りましょう！"],
    ["{name}さん、お昼はおいしかったですか？", "はい！{name}さんもちゃんと食べてくださいね。"],
    ["{name}さん、ちょっと外の空気を吸いに？", "はい、{name}さん。少し歩くと気持ちいいですね。"],
    ["{name}さん、今日の調子はどうですか？", "いいですよ！{name}さんはどうですか？"],
    [
      "{name}さん、今日もお疲れさまです。",
      "ありがとうございます、{name}さん。一緒に頑張りましょう！",
    ],
    ["{name}さん、カンバンタスクの進捗はいかがですか？", "単体テストを仕上げています、{name}さん！すぐレビューに出します。"],
    ["{name}さん、最新のプルリクエストを確認しましたか？", "はい、{name}さん！設計もテストカバレッジも万全です。"],
    ["{name}さん、CI/CDパイプラインは通りましたか？", "終了コード0で100%パスしています、{name}さん！デプロイ可能です。"],
    ["{name}さん、スプリントの優先タスクを同期しましょうか。", "いいですね、{name}さん！ブロッカーを一緒に解消しましょう。"],
    ["{name}さん、リファクタリングで手伝うことはありますか？", "ありがとうございます、{name}さん！並行処理のクエリを見ていただけますか？"],
    ["{name}さん、PMがマイルストーンを更新しましたね。", "見ました、{name}さん！重要成果物のリリースに集中しましょう。"],
    ["{name}さん、担当カードの実装と検証が完了しました！", "お疲れさまです、{name}さん！Readyから次のタスクを取りますね。"],
    ["{name}さん、Grafanaのエラーレートがゼロになりましたね。", "朗報ですね、{name}さん！修正パッチが安定稼働しています。"],
  ],
  zh: [
    ["{name}，祝你今天愉快！", "{name}，你也是！"],
    ["{name}，要不要伸展一下？", "好呀，{name}！肩膀正需要放松。"],
    ["{name}，喝过咖啡了吗？", "还没呢！多亏{name}提醒我。"],
    ["{name}，今天也很高兴见到你！", "我也是，{name}。今天也加油！"],
    ["{name}，午饭吃得好吗？", "很好！{name}也要好好吃饭哦。"],
    ["{name}，出去透透气吗？", "是的，{name}。走一走真舒服。"],
    ["{name}，今天状态怎么样？", "很好！{name}呢？"],
    ["{name}，今天也辛苦了。", "谢谢，{name}。一起加油！"],
    ["{name}，看板任务进展顺利吗？", "正在完善单元测试，{name}！马上提交审核。"],
    ["{name}，查看最新的Pull Request了吗？", "看过了，{name}！架构和测试覆盖率都非常稳健。"],
    ["{name}，CI/CD流水线全部绿灯了吗？", "退出代码0全绿通过，{name}！随时可以部署。"],
    ["{name}，我们同步一下冲刺的高优先级任务吧。", "好主意，{name}！一起排查解决待办阻塞点。"],
    ["{name}，重构或者排查需要帮忙吗？", "谢谢{name}！能帮我看看这块并发逻辑吗？"],
    ["{name}，PM刚刚更新了里程碑目标。", "看到了，{name}！我们全力攻坚关键业务交付。"],
    ["{name}，刚刚完成并验证了那张卡片。", "太棒了，{name}！我从Ready拉取下一个任务。"],
    ["{name}，Grafana上的报错率已经归零了。", "好消息，{name}！我们的稳定性补丁生效了。"],
  ],
};
export type SmalltalkActor = {
  id: string;
  name: string;
  x: number;
  y: number;
  walking: boolean;
  available: boolean;
};
type Line = { text: string; start: number; end: number };
export const SMALLTALK_PAUSE_MS = 7500;
export class NpcSmalltalk {
  private lineSet: readonly (readonly [string, string])[];
  /** The viewer's display locale. Unknown or missing locales fall back to English. */
  constructor(locale?: string | null) {
    this.lineSet = SMALLTALK_LINES[normalizeLocale(locale)];
  }
  /** Switch the viewer's locale. Lines already on screen stay; the next exchange uses the new locale. */
  setLocale(locale: string | null | undefined) {
    this.lineSet = SMALLTALK_LINES[normalizeLocale(locale)];
  }
  private encounters = new Map<string, { partner: string; until: number }>();
  partner(id: string, now: number) {
    const encounter = this.encounters.get(id);
    return encounter && now < encounter.until ? encounter.partner : undefined;
  }
  private lines = new Map<string, Line>();
  private cooldown = new Map<string, number>();
  private pairs = new Map<string, number>();
  private nextEncounter = 0;
  private lastTemplate = -1;
  text(id: string, now: number) {
    const line = this.lines.get(id);
    return line && now >= line.start && now < line.end ? line.text : undefined;
  }
  update(
    actors: SmalltalkActor[],
    now: number,
    canSee: (a: SmalltalkActor, b: SmalltalkActor) => boolean,
    random = Math.random,
  ) {
    const available = new Set(actors.filter((a) => a.available).map((a) => a.id));
    for (const [id, encounter] of this.encounters) {
      if (now >= encounter.until || !available.has(id) || !available.has(encounter.partner)) {
        this.encounters.delete(id);
        this.encounters.delete(encounter.partner);
        this.lines.delete(id);
        this.lines.delete(encounter.partner);
      }
    }
    for (const [id, line] of this.lines)
      if (now >= line.end || !available.has(id)) this.lines.delete(id);
    if (now < this.nextEncounter) return;
    for (let i = 0; i < actors.length; i++)
      for (let j = i + 1; j < actors.length; j++) {
        const a = actors[i],
          b = actors[j];
        const key = JSON.stringify([a.id, b.id].sort());
        if (
          !a.available ||
          !b.available ||
          !(a.walking || b.walking) ||
          Math.hypot(a.x - b.x, a.y - b.y) > 1.8 ||
          now < (this.cooldown.get(a.id) ?? 0) ||
          now < (this.cooldown.get(b.id) ?? 0) ||
          now < (this.pairs.get(key) ?? 0) ||
          !canSee(a, b)
        )
          continue;
        // Select uniformly from all templates except the previous exchange.
        let index = Math.floor(random() * (this.lineSet.length - (this.lastTemplate >= 0 ? 1 : 0)));
        if (this.lastTemplate >= 0 && index >= this.lastTemplate) index++;
        this.lastTemplate = index;
        const name = (value: string) => value.split(/\s*[·|]\s*/)[0].trim();
        this.lines.set(a.id, {
          text: this.lineSet[index][0].replace("{name}", name(b.name)),
          start: now,
          end: now + 4500,
        });
        this.lines.set(b.id, {
          text: this.lineSet[index][1].replace("{name}", name(a.name)),
          start: now + 2000,
          end: now + 6500,
        });
        this.encounters.set(a.id, { partner: b.id, until: now + SMALLTALK_PAUSE_MS });
        this.encounters.set(b.id, { partner: a.id, until: now + SMALLTALK_PAUSE_MS });
        this.cooldown.set(a.id, now + 45000);
        this.cooldown.set(b.id, now + 45000);
        this.pairs.set(key, now + 90000);
        this.nextEncounter = now + 12000;
        return;
      }
  }
}
