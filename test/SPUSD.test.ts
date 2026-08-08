import { expect } from "chai";
import { ethers } from "hardhat";
import { SPUSD, MockWrapper } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("SPUSD Token", function () {
  let spusd: SPUSD;
  let mockWrapper: MockWrapper;
  let owner: SignerWithAddress;
  let wrapper: SignerWithAddress;
  let user: SignerWithAddress;
  
  const MINTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("MINTER_ROLE"));
  const BURNER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BURNER_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  beforeEach(async function () {
    [owner, wrapper, user] = await ethers.getSigners();
    
    // Deploy MockWrapper first
    const MockWrapper = await ethers.getContractFactory("MockWrapper");
    mockWrapper = await MockWrapper.deploy();
    await mockWrapper.waitForDeployment();
    
    // Deploy SPUSD with MockWrapper address
    const SPUSD = await ethers.getContractFactory("SPUSD");
    spusd = await SPUSD.deploy(await mockWrapper.getAddress());
    await spusd.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      expect(await spusd.name()).to.equal("SoulPeg USD");
      expect(await spusd.symbol()).to.equal("SPUSD");
    });

    it("Should grant DEFAULT_ADMIN_ROLE to deployer", async function () {
      expect(await spusd.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.true;
    });

    it("Should have 18 decimals", async function () {
      expect(await spusd.decimals()).to.equal(18);
    });

    it("Should have correct MAX_SUPPLY", async function () {
      const maxSupply = await spusd.MAX_SUPPLY();
      expect(maxSupply).to.equal(ethers.parseEther("1000000000")); // 1B
    });
  });

  describe("Role Management", function () {
    it("Should allow admin to grant MINTER_ROLE", async function () {
      await spusd.grantRole(MINTER_ROLE, wrapper.address);
      expect(await spusd.hasRole(MINTER_ROLE, wrapper.address)).to.be.true;
    });

    it("Should allow admin to grant BURNER_ROLE", async function () {
      await spusd.grantRole(BURNER_ROLE, wrapper.address);
      expect(await spusd.hasRole(BURNER_ROLE, wrapper.address)).to.be.true;
    });

    it("Should not allow non-admin to grant roles", async function () {
      await expect(
        spusd.connect(user).grantRole(MINTER_ROLE, user.address)
      ).to.be.revertedWithCustomError(spusd, "AccessControlUnauthorizedAccount");
    });

    it("Should allow admin to renounce their role", async function () {
      await spusd.renounceRole(DEFAULT_ADMIN_ROLE, owner.address);
      expect(await spusd.hasRole(DEFAULT_ADMIN_ROLE, owner.address)).to.be.false;
    });
  });

  describe("Minting", function () {
    beforeEach(async function () {
      await spusd.grantRole(MINTER_ROLE, wrapper.address);
    });

    it("Should allow MINTER_ROLE to mint tokens", async function () {
      const amount = ethers.parseEther("1000");
      await spusd.connect(wrapper).mint(user.address, amount);
      expect(await spusd.balanceOf(user.address)).to.equal(amount);
    });

    it("Should not allow non-MINTER_ROLE to mint", async function () {
      const amount = ethers.parseEther("1000");
      await expect(
        spusd.connect(user).mint(user.address, amount)
      ).to.be.revertedWithCustomError(spusd, "AccessControlUnauthorizedAccount");
    });

    it("Should respect MAX_SUPPLY", async function () {
      const maxSupply = await spusd.MAX_SUPPLY();
      await expect(
        spusd.connect(wrapper).mint(user.address, maxSupply + 1n)
      ).to.be.revertedWith("SPUSD: Max supply exceeded");
    });

    it("Should update totalSupply after minting", async function () {
      const amount = ethers.parseEther("1000");
      await spusd.connect(wrapper).mint(user.address, amount);
      expect(await spusd.totalSupply()).to.equal(amount);
    });
  });

  describe("Burning", function () {
    const mintAmount = ethers.parseEther("1000");
    
    beforeEach(async function () {
      await spusd.grantRole(MINTER_ROLE, wrapper.address);
      await spusd.grantRole(BURNER_ROLE, wrapper.address);
      await spusd.connect(wrapper).mint(user.address, mintAmount);
    });

    it("Should allow BURNER_ROLE to burn tokens", async function () {
      const burnAmount = ethers.parseEther("500");
      await spusd.connect(wrapper).burnFrom(user.address, burnAmount);
      expect(await spusd.balanceOf(user.address)).to.equal(mintAmount - burnAmount);
    });

    it("Should not allow non-BURNER_ROLE to burn", async function () {
      const burnAmount = ethers.parseEther("500");
      await expect(
        spusd.connect(user).burnFrom(user.address, burnAmount)
      ).to.be.revertedWithCustomError(spusd, "AccessControlUnauthorizedAccount");
    });

    it("Should update totalSupply after burning", async function () {
      const burnAmount = ethers.parseEther("500");
      await spusd.connect(wrapper).burnFrom(user.address, burnAmount);
      expect(await spusd.totalSupply()).to.equal(mintAmount - burnAmount);
    });

    it("Should not allow burning more than balance", async function () {
      const burnAmount = mintAmount + ethers.parseEther("1");
      await expect(
        spusd.connect(wrapper).burnFrom(user.address, burnAmount)
      ).to.be.revertedWithCustomError(spusd, "ERC20InsufficientBalance");
    });
  });

  describe("Standard ERC20 Functions", function () {
    beforeEach(async function () {
      await spusd.grantRole(MINTER_ROLE, wrapper.address);
      await spusd.connect(wrapper).mint(owner.address, ethers.parseEther("1000"));
    });

    it("Should transfer tokens correctly", async function () {
      const amount = ethers.parseEther("100");
      await spusd.transfer(user.address, amount);
      expect(await spusd.balanceOf(user.address)).to.equal(amount);
    });

    it("Should approve and transferFrom correctly", async function () {
      const amount = ethers.parseEther("100");
      await spusd.approve(user.address, amount);
      await spusd.connect(user).transferFrom(owner.address, user.address, amount);
      expect(await spusd.balanceOf(user.address)).to.equal(amount);
    });
  });
});