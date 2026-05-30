import { render, screen, fireEvent } from "@testing-library/react";
import { ImageParamsBar } from "./image-params-bar";

describe("ImageParamsBar", () => {
  const defaultProps = {
    imageCount: "1",
    imageSize: "1:1",
    availableQuota: "100",
    activeTaskCount: 0,
    onImageCountChange: jest.fn(),
    onImageSizeChange: jest.fn(),
  };

  it("渲染基本状态信息", () => {
    render(<ImageParamsBar {...defaultProps} />);

    expect(screen.getByText(/剩余额度/)).toBeInTheDocument();
    expect(screen.getByText(/今日限制/)).toBeInTheDocument();
    expect(screen.getByText(/并发/)).toBeInTheDocument();
  });

  it("显示活跃任务数量", () => {
    render(<ImageParamsBar {...defaultProps} activeTaskCount={3} />);

    expect(screen.getByText(/3 个任务/)).toBeInTheDocument();
  });

  it("张数输入框可以修改", () => {
    const onImageCountChange = jest.fn();
    render(<ImageParamsBar {...defaultProps} onImageCountChange={onImageCountChange} />);

    const input = screen.getByDisplayValue("1");
    fireEvent.change(input, { target: { value: "4" } });

    expect(onImageCountChange).toHaveBeenCalledWith("4");
  });

  it("比例选择菜单可以打开和关闭", () => {
    render(<ImageParamsBar {...defaultProps} />);

    const button = screen.getByRole("button", { name: /比例/ });
    fireEvent.click(button);

    expect(screen.getByText("16:9 横版")).toBeInTheDocument();
    expect(screen.getByText("9:16 竖版")).toBeInTheDocument();
  });

  it("选择比例后调用回调", () => {
    const onImageSizeChange = jest.fn();
    render(<ImageParamsBar {...defaultProps} onImageSizeChange={onImageSizeChange} />);

    const button = screen.getByRole("button", { name: /比例/ });
    fireEvent.click(button);

    const option = screen.getByText("16:9 横版");
    fireEvent.click(option);

    expect(onImageSizeChange).toHaveBeenCalledWith("16:9");
  });

  it("参数面板可以打开", () => {
    render(<ImageParamsBar {...defaultProps} />);

    const button = screen.getByRole("button", { expanded: false });
    fireEvent.click(button);

    expect(screen.getByText("官方图片工具")).toBeInTheDocument();
  });

  it("显示提示词市场按钮", () => {
    const onOpenPromptMarket = jest.fn();
    render(<ImageParamsBar {...defaultProps} onOpenPromptMarket={onOpenPromptMarket} />);

    const button = screen.getByRole("button", { name: /市场/ });
    fireEvent.click(button);

    expect(onOpenPromptMarket).toHaveBeenCalled();
  });

  it("优化按钮在不可用时禁用", () => {
    const onOptimizePrompt = jest.fn();
    render(
      <ImageParamsBar
        {...defaultProps}
        onOptimizePrompt={onOptimizePrompt}
        canOptimizePrompt={false}
      />
    );

    const button = screen.getByRole("button", { name: /优化/ });
    expect(button).toBeDisabled();
  });

  it("显示每日限制信息", () => {
    render(
      <ImageParamsBar
        {...defaultProps}
        dailyLimit={{ requests: 100, images: 200 }}
      />
    );

    expect(screen.getByText(/请求 100 \/ 图片 200/)).toBeInTheDocument();
  });

  it("显示并发信息", () => {
    render(
      <ImageParamsBar
        {...defaultProps}
        activeTaskCount={2}
        concurrency={5}
      />
    );

    expect(screen.getByText(/2 \/ 5/)).toBeInTheDocument();
  });
});
